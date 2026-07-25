import type {
  PipelineDefinition,
  PipelineNode,
  PipelineEdge,
  PipelineGenerateRequest,
  PipelineGenerateResponse,
  Capability,
  ProcessingMethod,
  DocumentType,
  PipelineNodeConfig,
  DocumentInputConfig,
  PageClassifierConfig,
  CapabilityNodeConfig,
  MethodNodeConfig,
  SequentialComposerConfig,
  AggregatorConfig,
  OutputConfig,
} from '@idp/shared';
import {
  METHOD_INFO,
  METHODS,
  getBestMethodsForCapability,
  getMethodFamily,
  getSupportLevel,
  isMethodLanguageCompatible,
} from '@idp/shared';
import { isMethodConfigured } from './method-availability.js';

// Capabilities that Guardrails handles as a dedicated "PII specialist" stage
// (fed from an upstream LLM/BDA extraction stage via a sequential composer).
const PII_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'pii_detection',
  'pii_redaction',
]);

// ─── Method Selection Logic ──────────────────────────────────────────────────

interface MethodScore {
  method: ProcessingMethod;
  score: number;
  supportLevel: string;
  cost: number;
  speedRank: number;
}

// Speed ranks: lower = faster. Built dynamically from METHOD_INFO families.
const SPEED_RANK: Record<string, number> = {
  'claude-haiku': 1,
  'nova-lite': 2,
  'textract-nova-lite': 3,
  'textract-claude-haiku': 5,
  'claude-sonnet': 6,
  'textract-claude-sonnet': 8,
  'bda-standard': 9,
  'bda-claude-haiku': 10,
  'bda-nova-lite': 11,
  'bda-claude-sonnet': 12,
  'claude-opus': 13,
  'bda-custom': 14,
  'nova-embeddings': 15,
  // Frontier Claude tiers: Sonnet 5 is fast for its class; the Opus tiers think
  // adaptively and are the slowest but most accurate.
  'claude-sonnet-5': 6,
  'claude-opus-4-7': 16,
  'claude-opus-4-8': 17,
  'claude-opus-5': 18,
  // GPT tiers via Mantle (luna fastest → sol slowest).
  'gpt-5-6-luna': 5,
  'gpt-5-6-terra': 8,
  'gpt-5-6-sol': 13,
  'gpt-5-5': 13,
  // Guardrails is fast (Textract + deterministic policy eval, ~4s). Ranked
  // between nova-lite and textract-claude-haiku.
  'bedrock-guardrails': 4,
};

const OFFICE_DOC_TYPES: ReadonlySet<string> = new Set(['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls']);
/**
 * Families that can read video directly.
 *
 * `nova` only — verified against live Bedrock, not inferred from the API shape.
 * Claude was listed here because Converse HAS a `video` content block, but having
 * the block is not the same as a model accepting it: every Claude tier (Opus 5,
 * 4.8, 4.7, Sonnet 4.6/5, Haiku 4.5) rejects it with
 *   "This model doesn't support the video content block that you provided."
 * All 7 failed on a real 9-second mp4 through the deployed stack. Nova 2 Lite
 * reads the same file correctly. GPT goes through the Mantle Responses API, which
 * has no video path at all.
 *
 * Re-verify with a real file before adding a family here; the API surface lies.
 */
const VIDEO_CAPABLE_FAMILIES: ReadonlySet<string> = new Set(['nova']);

function selectMethod(
  capability: Capability,
  optimizeFor: string,
  preferredMethods?: ProcessingMethod[],
  documentLanguages?: string[],
  documentType?: string,
): ProcessingMethod | undefined {
  let candidates = getBestMethodsForCapability(capability);

  // No method supports this capability (preprocessing/reference entries, or an id
  // outside the catalog). Returning undefined lets the caller skip it; the
  // previous implicit `candidates[0]` returned undefined anyway and then blew up
  // two frames later on `METHOD_INFO[method].shortName`, which surfaced as an
  // opaque HTTP 500.
  if (candidates.length === 0) return undefined;

  /*
   * Drop methods this deployment cannot run, before any strategy is applied.
   *
   * Filtering only `preferredMethods` was not enough: when a capability maps to
   * exactly ONE family and that family is unavailable here, the sole candidate
   * survived and became a method node that can never execute. That is the real
   * state of `embedding_generation` and `knowledge_base_ingestion`, which map only
   * to `embeddings` — Nova Multimodal Embeddings has no processor in any route
   * registry and its model is not offered in us-west-2 at all. Verified live:
   * requesting either produced a pipeline whose only node was `nova-embeddings`.
   *
   * If nothing runnable is left the capability is unroutable; the caller reports
   * that instead of emitting a dead node.
   */
  const runnable = candidates.filter((m) => isMethodConfigured(m).available);
  if (runnable.length === 0) return undefined;
  candidates = runnable;

  /*
   * Media routing.
   *
   * The right mental model is that **BDA is to media what Textract is to pages**: a
   * managed extractor whose structured output an LLM then interprets. So the
   * preferred media path is the two-stage `bda-llm` family (BDA extracts shots,
   * timecodes and transcript; Claude/Nova/etc. structure it), exactly mirroring
   * `textract-llm` for documents. Verified live on a 9s mp4: BDA returned real shot
   * detection with timecodes and per-shot confidence, and the LLM stage structured
   * it — while `bda-standard` alone returns raw BDA JSON the user has to read.
   *
   * AUDIO is BDA-only. Converse has no audio content block, so any direct-LLM
   * method receives a UTF-8 decode of the container and fails.
   * VIDEO additionally works direct-to-Nova via the Converse video block. Claude is
   * NOT included — see VIDEO_CAPABLE_FAMILIES; all 7 tiers reject the block.
   */
  if (documentType === 'audio') {
    /*
     * Audio is BDA-only, and this filter is DELIBERATELY not a soft preference.
     *
     * The `if (length > 0)` idiom used by the other media/format filters means "prefer
     * these, but keep the rest rather than route nothing". That is wrong for audio: when
     * BDA is unconfigured the remaining candidate was Pegasus — rated `good` at
     * audio_transcription because it transcribes the audio track OF A VIDEO — and its
     * API takes a video media source, so a bare .mp3 fails inside the adapter. "Can
     * transcribe speech" and "can accept an audio container" are different questions and
     * the capability rating only answers the first.
     *
     * Returning undefined reports the capability as unroutable, which is the truth and
     * is what the caller already knows how to surface. A method node that cannot run is
     * strictly worse: the user pays for a failed run to learn the same thing.
     */
    const audioCapable = candidates.filter((m) => m.startsWith('bda-'));
    if (audioCapable.length === 0) return undefined;
    candidates = audioCapable;
  } else if (documentType === 'video') {
    const videoCapable = candidates.filter(
      (m) => m.startsWith('bda-') || VIDEO_CAPABLE_FAMILIES.has(getMethodFamily(m)),
    );
    if (videoCapable.length > 0) candidates = videoCapable;
  }

  // Filter out BDA/Textract for Office documents — they only support PDF/image
  if (documentType && OFFICE_DOC_TYPES.has(documentType)) {
    const officeFiltered = candidates.filter(
      (m) => !m.startsWith('bda-') && !m.startsWith('textract-') && m !== 'bda-standard' && m !== 'bda-custom',
    );
    if (officeFiltered.length > 0) candidates = officeFiltered;
  }

  // Filter out BDA/Textract for non-English documents
  if (documentLanguages?.length) {
    const langFiltered = candidates.filter((m) => isMethodLanguageCompatible(m, documentLanguages));
    if (langFiltered.length > 0) candidates = langFiltered;
  }

  // Filter to preferred methods if specified. When none of the preferred methods
  // can perform this capability, fall back to the FULL candidate list and still
  // apply the requested strategy below.
  //
  // This branch used to `return candidates[0]` directly, which silently discarded
  // optimizeFor: candidates are ordered by support level, so a request to
  // optimize for cost or speed returned the most ACCURATE method instead — the
  // opposite of what was asked, and the most expensive/slowest option. It is a
  // routine path, not an edge case: any capability outside the preferred set hits
  // it (e.g. preferring Nova 2 Lite, then requesting a PII capability that only
  // Guardrails and Claude support).
  const preferredMatches = preferredMethods?.length
    ? candidates.filter((m) => preferredMethods.includes(m))
    : candidates;
  const filtered = preferredMatches.length > 0 ? preferredMatches : candidates;

  /*
   * PII is not a cost/speed trade-off.
   *
   * Only `balanced` consults balancedScore, so the specialist preference for
   * Bedrock Guardrails applied to exactly one of the four strategies: optimizing
   * for cost routed PII redaction to Nova Lite and optimizing for speed to Claude
   * Haiku — i.e. it asked a generative model to redact its own output. A missed
   * redaction is a data leak, not a saving, so the deterministic policy engine
   * wins under every strategy whenever it is genuinely available here.
   */
  if (PII_CAPABILITIES.has(capability)) {
    const specialist = filtered.find((m) => getMethodFamily(m) === 'guardrails');
    if (specialist) return specialist;
  }

  /*
   * Quality floor for the cost and speed strategies.
   *
   * Both used to sort the whole candidate list with no regard for how well the
   * method performs the capability, so they returned a method rated `limited`
   * whenever it happened to be cheapest or fastest. Measured on `bounding_box`
   * after the per-tier corrections: `cost` chose Nova 2 Lite and `speed` chose
   * Claude Haiku, both `limited`, while capable tiers were available — the user
   * asked for the cheapest way to do the job, not the cheapest method that will
   * probably fail at it.
   *
   * `limited` is only accepted when nothing better exists, so a capability that
   * genuinely has no strong method still routes rather than failing.
   */
  const usable = filtered.filter((m) => getSupportLevel(m, capability) !== 'limited');
  const pool = usable.length > 0 ? usable : filtered;

  switch (optimizeFor) {
    case 'accuracy':
      // Already sorted by support level (excellent > good > limited)
      return filtered[0];

    case 'cost':
      // Cheapest method that can actually do the job.
      return pool.slice().sort(
        (a, b) => METHOD_INFO[a].estimatedCostPerPage - METHOD_INFO[b].estimatedCostPerPage,
      )[0];

    case 'speed':
      // Fastest method that can actually do the job.
      return pool.slice().sort(
        (a, b) => (SPEED_RANK[a] ?? UNKNOWN_SPEED_RANK) - (SPEED_RANK[b] ?? UNKNOWN_SPEED_RANK),
      )[0];

    case 'balanced':
      // Weighted score: 40% accuracy, 30% cost, 30% speed
      return filtered.sort((a, b) => {
        const scoreA = balancedScore(a, capability);
        const scoreB = balancedScore(b, capability);
        return scoreB - scoreA; // Higher score is better
      })[0];

    default:
      return filtered[0];
  }
}

/**
 * Normalisation bounds, derived from the tables rather than hardcoded.
 *
 * Both of these used to be literals sized for the original, smaller catalog:
 * `maxCost = 0.04` and a speed divisor of `11`. Adding the frontier tiers pushed
 * SPEED_RANK to 18, so `((11 - rank) / 11) * 100` produced a NEGATIVE speed score
 * (-64 for Opus 5) instead of a 0-100 one. A negative term is not a low score —
 * it actively subtracts from accuracy, so the balanced strategy penalised the
 * most capable models far beyond the intended 30% speed weight. Deriving the
 * bounds keeps the score in range as the catalog grows.
 */
const MAX_SPEED_RANK = Math.max(...Object.values(SPEED_RANK));
const MAX_COST_PER_PAGE = Math.max(
  ...Object.values(METHOD_INFO).map((m) => m.estimatedCostPerPage),
);

/** Rank used for a method absent from SPEED_RANK: assume slowest, not median. */
const UNKNOWN_SPEED_RANK = MAX_SPEED_RANK;

function balancedScore(method: ProcessingMethod, capability: Capability): number {
  const info = METHOD_INFO[method];
  const family = getMethodFamily(method);
  // getSupportLevel, not the raw family table: a per-method override (e.g. the
  // frontier tiers being genuinely good at bounding boxes) must influence the
  // score, otherwise the matrix and the selection would disagree.
  const supportLevel = getSupportLevel(method, capability);

  // Accuracy score (0-100)
  const accuracyScore =
    supportLevel === 'excellent' ? 100 : supportLevel === 'good' ? 70 : supportLevel === 'limited' ? 40 : 0;

  // Cost score (0-100, lower cost = higher score)
  const costScore = ((MAX_COST_PER_PAGE - info.estimatedCostPerPage) / MAX_COST_PER_PAGE) * 100;

  // Speed score (0-100, lower rank = higher score)
  const speedRank = SPEED_RANK[method] ?? UNKNOWN_SPEED_RANK;
  const speedScore = ((MAX_SPEED_RANK - speedRank) / MAX_SPEED_RANK) * 100;

  // Weighted average: 40% accuracy, 30% cost, 30% speed
  let score = accuracyScore * 0.4 + costScore * 0.3 + speedScore * 0.3;

  /*
   * PII specialist preference.
   *
   * For PII detection/redaction, Guardrails is deterministic and policy-driven
   * while an LLM is asked to self-redact — and a missed redaction is a data leak,
   * not a quality trade-off you accept to save money. So the preference must
   * dominate the cost and speed terms rather than merely break ties.
   *
   * The previous flat +25 was calibrated when Guardrails was believed to cost
   * $0.0016/page. Correcting that to $0.0501 (it calls Textract AnalyzeDocument
   * with FORMS, not plain OCR) made the cost term large enough to overturn the
   * bonus, and Claude Haiku started winning PII routing — a correctness
   * regression caused by a pricing fix. The bonus is now large enough that no
   * cost/speed advantage can outrank the purpose-built engine.
   */
  if (PII_CAPABILITIES.has(capability) && family === 'guardrails') {
    score += 100;
  }

  return score;
}

/**
 * Test-only. The 0-100 normalisation silently broke once SPEED_RANK outgrew its
 * hardcoded divisor, so the bounds are worth pinning directly rather than
 * inferring them from which method a pipeline happened to pick.
 */
export const scoringBoundsForTest = {
  maxSpeedRank: MAX_SPEED_RANK,
  maxCostPerPage: MAX_COST_PER_PAGE,
  balancedScore,
};

// ─── Page Classifier Logic ───────────────────────────────────────────────────

function getBestMethodForContentType(contentType: string): ProcessingMethod {
  switch (contentType) {
    case 'table':
      // Table-heavy pages → textract-llm methods (best native table detection)
      return 'textract-claude-sonnet';
    case 'image':
      // Image-heavy pages → claude or nova (best vision)
      return 'claude-sonnet';
    case 'text-only':
      // Text-only pages → cheapest method
      return 'nova-lite';
    case 'form':
      // Forms → textract-llm (best form field detection)
      return 'textract-claude-haiku';
    case 'mixed':
      // Mixed content → balanced approach
      return 'claude-sonnet';
    default:
      return 'claude-sonnet';
  }
}

// ─── Pipeline Generation ─────────────────────────────────────────────────────

let pipelineIdCounter = 1;
let nodeIdCounter = 1;
let edgeIdCounter = 1;

function generatePipelineId(): string {
  return `pipeline-${Date.now()}-${pipelineIdCounter++}`;
}

function generateNodeId(type: string): string {
  return `${type}-${nodeIdCounter++}`;
}

function generateEdgeId(): string {
  return `edge-${edgeIdCounter++}`;
}

export function generatePipeline(
  request: PipelineGenerateRequest,
  skipAlternatives: boolean = false,
): PipelineGenerateResponse {
  const {
    documentType,
    capabilities,
    methodAssignments,
    optimizeFor,
    enableHybridRouting,
    documentLanguages,
  } = request;

  /*
   * Restrict candidates to methods this deployment can actually run.
   *
   * Availability was enforced only at EXECUTION time, so generation happily
   * proposed a method the deployment cannot run and the user found out when the
   * node failed. With "optimize for accuracy" this was the common case rather
   * than an edge case: bda-custom outranks every other BDA method, so the
   * accuracy pipeline recommended a custom-blueprint method that is deliberately
   * left unconfigured here — visible in the UI as a canvas node that errors
   * immediately with "Needs a custom blueprint project".
   *
   * Format/language/capability rules still belong to execution (they depend on
   * the actual upload); this filter is configuration-only, which is exactly what
   * is knowable at generation time.
   */
  const configuredMethods = (request.preferredMethods ?? METHODS).filter(
    (m) => isMethodConfigured(m).available,
  );
  const preferredMethods = configuredMethods.length > 0 ? configuredMethods : request.preferredMethods;

  // Reset counters for consistent IDs within this generation
  nodeIdCounter = 1;
  edgeIdCounter = 1;

  const nodes: PipelineNode[] = [];
  const edges: PipelineEdge[] = [];
  let xPos = 50;
  const yPos = 200;
  const xStep = 280;

  // 1. Document Input Node
  const inputNodeId = generateNodeId('input');
  nodes.push({
    id: inputNodeId,
    type: 'document-input',
    label: 'Document Input',
    description: `Accepts ${documentType} documents`,
    config: {
      nodeType: 'document-input',
      acceptedTypes: [documentType],
      maxPages: 100,
    } as DocumentInputConfig,
    position: { x: xPos, y: yPos },
  });
  xPos += xStep;

  let previousNodeIds = [inputNodeId];

  // 2. Page Classifier (if hybrid routing enabled)
  let classifierNodeId: string | undefined;
  if (enableHybridRouting) {
    classifierNodeId = generateNodeId('classifier');
    nodes.push({
      id: classifierNodeId,
      type: 'page-classifier',
      label: 'Page Classifier',
      description: 'Routes pages by content type to optimal methods',
      config: {
        nodeType: 'page-classifier',
        classifyBy: 'content-type',
        contentTypes: ['table', 'image', 'text-only', 'form', 'mixed'],
      } as PageClassifierConfig,
      position: { x: xPos, y: yPos },
    });
    xPos += xStep;

    edges.push({
      id: generateEdgeId(),
      source: inputNodeId,
      target: classifierNodeId,
      label: 'classify',
    });

    previousNodeIds = [classifierNodeId];
  }

  // 3. Method Selection — group capabilities by their best method.
  //    Explicit `methodAssignments` (from chat) win per-capability; any gaps
  //    fall back to the auto-selection heuristic.
  const methodToCapabilities = new Map<ProcessingMethod, Capability[]>();

  const unroutable: Capability[] = [];
  const skippedCapabilities: Array<{ capability: string; reason: string }> = [];
  for (const capability of capabilities) {
    const explicit = methodAssignments?.[capability];
    const method = explicit ?? selectMethod(capability, optimizeFor, preferredMethods, documentLanguages, documentType);
    // Skip capabilities no method can perform, and any explicit assignment naming
    // a method that is not in the catalog (e.g. a stale id from a saved run).
    if (!method || !METHOD_INFO[method]) {
      unroutable.push(capability);
      // Explain WHY, distinguishing "no method supports this" from "the only
      // method that supports it cannot run in this deployment". Silently dropping
      // the capability made it look like the request had been honoured.
      const supporting = getBestMethodsForCapability(capability);
      skippedCapabilities.push({
        capability,
        reason: supporting.length === 0
          ? 'No processing method performs this capability (it is a preprocessing or reference-only entry).'
          : (isMethodConfigured(supporting[0]).detail
            ?? 'No method that supports this capability is available in this deployment.'),
      });
      continue;
    }
    if (!methodToCapabilities.has(method)) {
      methodToCapabilities.set(method, []);
    }
    methodToCapabilities.get(method)!.push(capability);
  }

  if (methodToCapabilities.size === 0) {
    throw new Error(
      `No processing method supports the requested capabilities: ${unroutable.join(', ')}`,
    );
  }

  // 3a. Detect a sequential composition pattern:
  //     - One stage extracts/summarizes text with an LLM/BDA method.
  //     - A downstream Guardrails stage consumes that text and applies PII
  //       redaction/detection. We only enter sequential mode when both a PII
  //       capability is assigned to Guardrails AND at least one non-PII
  //       capability is assigned to a different method. Otherwise we fall back
  //       to the normal parallel layout.
  const guardrailsMethod: ProcessingMethod = 'bedrock-guardrails';
  const guardrailsCaps = methodToCapabilities.get(guardrailsMethod) ?? [];
  const hasGuardrailsStage = guardrailsCaps.length > 0 && guardrailsCaps.every((c) => PII_CAPABILITIES.has(c));
  const nonGuardrailsMethods = Array.from(methodToCapabilities.entries())
    .filter(([m]) => m !== guardrailsMethod);
  const sequentialMode = hasGuardrailsStage && nonGuardrailsMethods.length >= 1;

  // 4. Method Nodes (each method handles its assigned capabilities as sub-items).
  //    In sequential mode we lay out extract methods in one column, then the
  //    Guardrails node in the next column, then the output. Otherwise we use
  //    the original parallel-with-aggregator layout.
  const methodNodeIds: string[] = [];
  let preOutputNodeId: string;

  if (sequentialMode) {
    const extractMethodNodeIds: string[] = [];

    // Column 1 of methods: parallel LLM/BDA extract stage(s).
    const extractMethodCount = nonGuardrailsMethods.length;
    const extractYStart = yPos - (extractMethodCount * 140) / 2;
    nonGuardrailsMethods.forEach(([method, caps], idx) => {
      const extractNodeId = generateNodeId('method');
      extractMethodNodeIds.push(extractNodeId);
      methodNodeIds.push(extractNodeId);
      const info = METHOD_INFO[method];
      nodes.push({
        id: extractNodeId,
        type: 'method',
        label: info.shortName,
        description: `${info.name} - extract (${caps.length} capability${caps.length > 1 ? 's' : ''})`,
        config: {
          nodeType: 'method',
          method,
          family: info.family,
          capabilities: caps,
        } as MethodNodeConfig & { capabilities: string[] },
        position: { x: xPos, y: extractYStart + idx * 140 },
      });
      for (const prevId of previousNodeIds) {
        edges.push({ id: generateEdgeId(), source: prevId, target: extractNodeId, label: 'extract' });
      }
    });
    xPos += xStep;

    // Column 2: Guardrails redact/detect stage, fed by the extract stage text.
    const guardrailsNodeId = generateNodeId('method');
    methodNodeIds.push(guardrailsNodeId);
    const gInfo = METHOD_INFO[guardrailsMethod];
    nodes.push({
      id: guardrailsNodeId,
      type: 'method',
      label: gInfo.shortName,
      description: `${gInfo.name} - ${guardrailsCaps.map((c) => c.replace(/_/g, ' ')).join(', ')}`,
      config: {
        nodeType: 'method',
        method: guardrailsMethod,
        family: gInfo.family,
        capabilities: guardrailsCaps,
      } as MethodNodeConfig & { capabilities: string[] },
      position: { x: xPos, y: yPos },
    });
    for (const extractNodeId of extractMethodNodeIds) {
      edges.push({ id: generateEdgeId(), source: extractNodeId, target: guardrailsNodeId, label: 'text→redact' });
    }
    xPos += xStep;

    // Sequential composer — metadata-only node (hidden from canvas, visible=false).
    // The executor reads stages from this node to orchestrate serial execution.
    const composerNodeId = generateNodeId('composer');
    nodes.push({
      id: composerNodeId,
      type: 'sequential-composer',
      label: 'Sequential Composer',
      description: 'Chains extract → Guardrails redact',
      config: {
        nodeType: 'sequential-composer',
        stages: [...extractMethodNodeIds, guardrailsNodeId],
      } as SequentialComposerConfig,
      position: { x: -9999, y: -9999 },
    });
    preOutputNodeId = guardrailsNodeId;
  } else {
    const methodYStart = yPos - (methodToCapabilities.size * 140) / 2;
    let methodIdx = 0;

    for (const [method, caps] of methodToCapabilities.entries()) {
      const methodNodeId = generateNodeId('method');
      methodNodeIds.push(methodNodeId);

      const info = METHOD_INFO[method];
      nodes.push({
        id: methodNodeId,
        type: 'method',
        label: info.shortName,
        description: `${info.name} - processes ${caps.length} capability(s)`,
        config: {
          nodeType: 'method',
          method,
          family: info.family,
          capabilities: caps,
        } as MethodNodeConfig & { capabilities: string[] },
        position: { x: xPos, y: methodYStart + methodIdx * 140 },
      });

      for (const prevId of previousNodeIds) {
        edges.push({
          id: generateEdgeId(),
          source: prevId,
          target: methodNodeId,
        });
      }

      methodIdx++;
    }
    xPos += xStep;

    // 5. Aggregator Node (only when multiple methods need merging)
    if (methodNodeIds.length > 1) {
      const aggregatorNodeId = generateNodeId('aggregator');
      nodes.push({
        id: aggregatorNodeId,
        type: 'aggregator',
        label: 'Aggregator',
        description: 'Combines results from all methods',
        config: {
          nodeType: 'aggregator',
          strategy: optimizeFor === 'accuracy' ? 'best-confidence' : optimizeFor === 'cost' ? 'best-cost' : optimizeFor === 'speed' ? 'best-speed' : 'best-confidence',
        } as AggregatorConfig,
        position: { x: xPos, y: yPos },
      });

      for (const methodNodeId of methodNodeIds) {
        edges.push({
          id: generateEdgeId(),
          source: methodNodeId,
          target: aggregatorNodeId,
        });
      }
      preOutputNodeId = aggregatorNodeId;
      xPos += xStep;
    } else {
      preOutputNodeId = methodNodeIds[0];
    }
  }

  // 6. Output Node
  const outputNodeId = generateNodeId('output');
  nodes.push({
    id: outputNodeId,
    type: 'pipeline-output',
    label: 'Output',
    description: 'Final structured output',
    config: {
      nodeType: 'output',
      format: 'json',
      includeMetrics: true,
      includeArchitecture: true,
    } as OutputConfig,
    position: { x: xPos, y: yPos },
  });

  edges.push({
    id: generateEdgeId(),
    source: preOutputNodeId,
    target: outputNodeId,
  });

  // 7. Calculate estimated cost and latency
  const uniqueMethods = Array.from(methodToCapabilities.keys());
  // Cost = sum of all unique method costs (each method runs once per page)
  const estimatedCostPerPage = uniqueMethods.reduce((sum, method) => {
    return sum + METHOD_INFO[method].estimatedCostPerPage;
  }, 0);

  // Latency estimation:
  //  - Parallel mode: max over all method latencies + classifier overhead.
  //  - Sequential mode: max(extract stage) + guardrails stage (run serially).
  const latencyFor = (m: ProcessingMethod) => {
    const family = METHOD_INFO[m].family;
    if (family === 'bda') return 15000;
    if (family === 'bda-llm') return 25000;
    if (family === 'textract-llm') return 8000;
    if (family === 'guardrails') return 4000;
    if (family === 'embeddings') return 2000;
    return 5000;
  };
  let estimatedLatencyMs: number;
  if (sequentialMode) {
    const extractMax = Math.max(
      ...nonGuardrailsMethods.map(([m]) => latencyFor(m)),
    );
    estimatedLatencyMs = extractMax + latencyFor(guardrailsMethod) + (enableHybridRouting ? 500 : 0);
  } else {
    estimatedLatencyMs = Math.max(...uniqueMethods.map(latencyFor)) + (enableHybridRouting ? 500 : 0);
  }

  const pipeline: PipelineDefinition = {
    id: generatePipelineId(),
    name: `${optimizeFor.charAt(0).toUpperCase() + optimizeFor.slice(1)}-Optimized Pipeline`,
    description: `Pipeline optimized for ${optimizeFor} with ${capabilities.length} capability(s) using ${uniqueMethods.length} method(s)${enableHybridRouting ? ' (hybrid routing enabled)' : ''}`,
    nodes,
    edges,
    estimatedCostPerPage,
    estimatedLatencyMs,
    createdAt: new Date().toISOString(),
  };

  // 8. Generate alternatives with different optimization strategies
  const alternatives: PipelineDefinition[] = [];

  if (!skipAlternatives) {
    const alternativeStrategies: Array<'accuracy' | 'cost' | 'speed' | 'balanced'> = [
      'accuracy',
      'cost',
      'speed',
      'balanced',
    ].filter((s) => s !== optimizeFor) as Array<'accuracy' | 'cost' | 'speed' | 'balanced'>;

    for (const altStrategy of alternativeStrategies.slice(0, 2)) {
      const altPipeline = generatePipeline({
        ...request,
        optimizeFor: altStrategy,
      }, true).pipeline; // Pass true to skip alternatives in recursive call
      alternatives.push(altPipeline);
    }
  }

  // 9. Generate rationale
  const rationale = generateRationale(
    request,
    uniqueMethods,
    methodToCapabilities,
    sequentialMode,
  );

  return {
    pipeline,
    alternatives,
    rationale,
    ...(skippedCapabilities.length > 0 ? { skippedCapabilities } : {}),
  };
}

function generateRationale(
  request: PipelineGenerateRequest,
  selectedMethods: ProcessingMethod[],
  methodToCapabilities: Map<ProcessingMethod, Capability[]>,
  sequentialMode: boolean = false,
): string {
  const { optimizeFor, capabilities, enableHybridRouting } = request;

  const lines: string[] = [];
  lines.push(`**Pipeline Optimization Strategy: ${optimizeFor.toUpperCase()}**\n`);

  if (sequentialMode) {
    lines.push(
      `**Composition: Sequential**\nExtraction runs first (LLM/BDA), then its text output is piped into Amazon Bedrock Guardrails for PII detection/redaction. This avoids asking an LLM to self-redact and keeps PII handling deterministic.\n`,
    );
  }

  lines.push(`**Selected Methods:**`);
  for (const method of selectedMethods) {
    const info = METHOD_INFO[method];
    const caps = methodToCapabilities.get(method) || [];
    lines.push(
      `- **${info.shortName}** (${info.family}): Handles ${caps.length} capability(s) - ${caps.map((c) => c.replace(/_/g, ' ')).join(', ')}`,
    );
    lines.push(`  - Cost: $${info.estimatedCostPerPage.toFixed(4)}/page`);
    lines.push(`  - Strengths: ${info.strengths.slice(0, 2).join(', ')}`);
  }

  lines.push(`\n**Method Deduplication:**`);
  if (selectedMethods.length < capabilities.length) {
    lines.push(
      `✓ Optimized from ${capabilities.length} capabilities to ${selectedMethods.length} method(s) by consolidating compatible capabilities.`,
    );
  } else {
    lines.push(
      `Each capability requires a different method for optimal ${optimizeFor}.`,
    );
  }

  if (enableHybridRouting) {
    lines.push(`\n**Hybrid Routing Enabled:**`);
    lines.push(
      `Pages are classified by content type (table/image/text-only/form/mixed) and routed to the most suitable method for each type.`,
    );
  }

  if (request.documentLanguages?.length) {
    const isEnglish = request.documentLanguages.every((l) => l.toLowerCase().startsWith('en'));
    if (!isEnglish) {
      /*
       * State the measurement, not a vague caveat. "Do not reliably support" reads
       * like a minor quality note; the real gap is severe. Measured on a Korean
       * quotation with known ground truth, recall of content verifiably present in
       * the document: every BDA method 32%, every Textract hybrid 37-42%, versus
       * 100% for the Claude and GPT tiers. Two of the excluded methods also reported
       * 87-93% self-confidence while recovering a third of the page, which is why
       * the exclusion is a routing rule rather than a warning the user can weigh.
       */
      lines.push(`\n**Language Constraint:**`);
      lines.push(
        `Document language(s): ${request.documentLanguages.join(', ')}. BDA and Textract methods were excluded: `
        + `measured against a Korean document with known ground truth they recovered only 32% (BDA) and `
        + `37-42% (Textract+LLM) of the content actually present, while the multimodal LLMs recovered 100%. `
        + `Textract's own OCR confidence drops to ~63% on Korean versus ~100% on English. `
        + `Only Claude, Nova and GPT (multimodal LLM) methods are used.`,
      );
    }
  }

  lines.push(`\n**Why This Configuration?**`);
  switch (optimizeFor) {
    case 'accuracy':
      lines.push(
        `Methods with 'excellent' support level were prioritized for maximum extraction quality.`,
      );
      break;
    case 'cost':
      lines.push(
        `Methods with lowest cost-per-page were selected while maintaining 'good' or better support.`,
      );
      break;
    case 'speed':
      lines.push(
        `Faster models (Haiku, Nova Lite) were prioritized for reduced latency.`,
      );
      break;
    case 'balanced':
      lines.push(
        `Methods were scored using a weighted formula (40% accuracy, 30% cost, 30% speed) for optimal trade-offs.`,
      );
      break;
  }

  return lines.join('\n');
}
