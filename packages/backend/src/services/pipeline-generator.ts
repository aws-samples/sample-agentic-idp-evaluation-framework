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
  CAPABILITY_SUPPORT,
  METHOD_INFO,
  getBestMethodsForCapability,
  getMethodFamily,
  isMethodLanguageCompatible,
} from '@idp/shared';

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
  'nova-pro': 4,
  'textract-claude-haiku': 5,
  'claude-sonnet': 6,
  'textract-nova-pro': 7,
  'textract-claude-sonnet': 8,
  'bda-standard': 9,
  'bda-claude-haiku': 10,
  'bda-nova-lite': 11,
  'bda-claude-sonnet': 12,
  'claude-opus': 13,
  'bda-custom': 14,
  'nova-embeddings': 15,
  // Guardrails is fast (Textract + deterministic policy eval, ~4s). Ranked
  // between nova-pro and textract-claude-haiku.
  'bedrock-guardrails': 4,
};

const OFFICE_DOC_TYPES: ReadonlySet<string> = new Set(['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls']);

function selectMethod(
  capability: Capability,
  optimizeFor: string,
  preferredMethods?: ProcessingMethod[],
  documentLanguages?: string[],
  documentType?: string,
): ProcessingMethod {
  let candidates = getBestMethodsForCapability(capability);

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

  // Filter to preferred methods if specified
  const filtered =
    preferredMethods?.length
      ? candidates.filter((m) => preferredMethods.includes(m))
      : candidates;

  if (filtered.length === 0) {
    // Fallback to first candidate if no preferred methods match
    return candidates[0];
  }

  switch (optimizeFor) {
    case 'accuracy':
      // Already sorted by support level (excellent > good > limited)
      return filtered[0];

    case 'cost':
      // Pick cheapest method
      return filtered.sort(
        (a, b) => METHOD_INFO[a].estimatedCostPerPage - METHOD_INFO[b].estimatedCostPerPage,
      )[0];

    case 'speed':
      // Prefer smaller, faster models
      return filtered.sort(
        (a, b) => (SPEED_RANK[a] ?? 99) - (SPEED_RANK[b] ?? 99),
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

function balancedScore(method: ProcessingMethod, capability: Capability): number {
  const info = METHOD_INFO[method];
  const family = getMethodFamily(method);
  const supportLevel = CAPABILITY_SUPPORT[family]?.[capability];

  // Accuracy score (0-100)
  const accuracyScore =
    supportLevel === 'excellent' ? 100 : supportLevel === 'good' ? 70 : supportLevel === 'limited' ? 40 : 0;

  // Cost score (0-100, lower cost = higher score)
  const maxCost = 0.04; // bda-custom
  const costScore = ((maxCost - info.estimatedCostPerPage) / maxCost) * 100;

  // Speed score (0-100, lower rank = higher score)
  const speedRank = SPEED_RANK[method] ?? 11;
  const speedScore = ((11 - speedRank) / 11) * 100;

  // Weighted average: 40% accuracy, 30% cost, 30% speed
  let score = accuracyScore * 0.4 + costScore * 0.3 + speedScore * 0.3;

  // Bonus for PII specialist — Guardrails is deterministic and purpose-built,
  // so it should win ties for PII capabilities even when cheaper/faster LLMs
  // exist. Applied only when the method's family is 'guardrails'.
  if (PII_CAPABILITIES.has(capability) && family === 'guardrails') {
    score += 25;
  }

  return score;
}

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
    preferredMethods,
    methodAssignments,
    optimizeFor,
    enableHybridRouting,
    documentLanguages,
  } = request;

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

  for (const capability of capabilities) {
    const explicit = methodAssignments?.[capability];
    const method = explicit ?? selectMethod(capability, optimizeFor, preferredMethods, documentLanguages, documentType);
    if (!methodToCapabilities.has(method)) {
      methodToCapabilities.set(method, []);
    }
    methodToCapabilities.get(method)!.push(capability);
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
      lines.push(`\n**Language Constraint:**`);
      lines.push(
        `Document language(s): ${request.documentLanguages.join(', ')}. BDA and Textract methods were excluded as they do not reliably support non-English documents. Only Claude and Nova (multimodal LLM) methods are used.`,
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
