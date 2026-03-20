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
  AggregatorConfig,
  OutputConfig,
} from '@idp/shared';
import {
  CAPABILITY_SUPPORT,
  METHOD_INFO,
  getBestMethodsForCapability,
  getMethodFamily,
} from '@idp/shared';

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
};

function selectMethod(
  capability: Capability,
  optimizeFor: string,
  preferredMethods?: ProcessingMethod[],
): ProcessingMethod {
  const candidates = getBestMethodsForCapability(capability);

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
  return accuracyScore * 0.4 + costScore * 0.3 + speedScore * 0.3;
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
    optimizeFor,
    enableHybridRouting,
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

  // 3. Method Selection — group capabilities by their best method
  const methodToCapabilities = new Map<ProcessingMethod, Capability[]>();

  for (const capability of capabilities) {
    const method = selectMethod(capability, optimizeFor, preferredMethods);
    if (!methodToCapabilities.has(method)) {
      methodToCapabilities.set(method, []);
    }
    methodToCapabilities.get(method)!.push(capability);
  }

  // 4. Method Nodes (each method handles its assigned capabilities as sub-items)
  const methodNodeIds: string[] = [];
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

    // Connect from previous nodes (input or classifier)
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

  // 5. Aggregator Node
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
  xPos += xStep;

  // 6. Output Node
  const outputNodeId = generateNodeId('output');
  nodes.push({
    id: outputNodeId,
    type: 'output',
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
    source: aggregatorNodeId,
    target: outputNodeId,
  });

  // 7. Calculate estimated cost and latency
  const uniqueMethods = Array.from(methodToCapabilities.keys());
  // Cost = sum of all unique method costs (each method runs once per page)
  const estimatedCostPerPage = uniqueMethods.reduce((sum, method) => {
    return sum + METHOD_INFO[method].estimatedCostPerPage;
  }, 0);

  // Latency estimation: methods run in parallel, add classifier overhead
  const methodLatencies = uniqueMethods.map((m) => {
    const family = METHOD_INFO[m].family;
    if (family === 'bda') return 15000;
    if (family === 'bda-llm') return 25000; // BDA polling + LLM streaming
    if (family === 'textract-llm') return 8000;
    if (family === 'embeddings') return 2000;
    return 5000; // claude, nova
  });
  const estimatedLatencyMs = Math.max(...methodLatencies) + (enableHybridRouting ? 500 : 0);

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
): string {
  const { optimizeFor, capabilities, enableHybridRouting } = request;

  const lines: string[] = [];
  lines.push(`**Pipeline Optimization Strategy: ${optimizeFor.toUpperCase()}**\n`);

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
