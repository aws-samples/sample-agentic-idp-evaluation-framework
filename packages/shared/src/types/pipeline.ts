import type { Capability } from './capabilities.js';
import type { ProcessingMethod, MethodFamily } from './processing.js';
import type { DocumentType } from './documents.js';

// ─── Pipeline Node Types ──────────────────────────────────────────────────────

export type PipelineNodeType =
  | 'document-input'
  | 'page-classifier'
  | 'capability'
  | 'method'
  | 'sequential-composer'
  | 'aggregator'
  | 'pipeline-output';

export interface PipelineNode {
  id: string;
  type: PipelineNodeType;
  label: string;
  description?: string;
  config: PipelineNodeConfig;
  position: { x: number; y: number };
}

export type PipelineNodeConfig =
  | DocumentInputConfig
  | PageClassifierConfig
  | CapabilityNodeConfig
  | MethodNodeConfig
  | SequentialComposerConfig
  | AggregatorConfig
  | OutputConfig;

export interface DocumentInputConfig {
  nodeType: 'document-input';
  acceptedTypes: DocumentType[];
  maxPages?: number;
}

export interface PageClassifierConfig {
  nodeType: 'page-classifier';
  classifyBy: 'content-type' | 'document-type' | 'custom';
  contentTypes: ('table' | 'image' | 'text-only' | 'form' | 'mixed')[];
}

export interface CapabilityNodeConfig {
  nodeType: 'capability';
  capability: Capability;
  priority: 'required' | 'optional';
}

export interface MethodNodeConfig {
  nodeType: 'method';
  method: ProcessingMethod;
  family: MethodFamily;
  fallback?: ProcessingMethod;
}

export interface AggregatorConfig {
  nodeType: 'aggregator';
  strategy: 'best-confidence' | 'best-cost' | 'best-speed' | 'ensemble' | 'custom';
}

/**
 * Sequential composer: chains one method's text output into the next method's
 * input. Used for workflows like "LLM extraction → Guardrails redaction" where
 * the downstream step needs the upstream step's extracted text rather than the
 * raw document. `stages` lists method node IDs in execution order.
 */
export interface SequentialComposerConfig {
  nodeType: 'sequential-composer';
  stages: string[]; // method node IDs, in order
  passTextFromStage?: number; // which stage's text output to feed forward (default: last)
}

export interface OutputConfig {
  nodeType: 'output';
  format: 'json' | 'markdown' | 'html' | 'csv';
  includeMetrics: boolean;
  includeArchitecture: boolean;
}

// ─── Pipeline Edge ────────────────────────────────────────────────────────────

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
}

// ─── Pipeline Definition ──────────────────────────────────────────────────────

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  estimatedCostPerPage: number;
  estimatedLatencyMs: number;
  createdAt: string;
}

// ─── Pipeline Generation Request/Response ─────────────────────────────────────

export interface PipelineGenerateRequest {
  documentType: DocumentType;
  capabilities: Capability[];
  preferredMethods?: ProcessingMethod[];
  /**
   * Explicit per-capability method assignment. When supplied, the generator
   * uses these mappings verbatim (falling back to auto-selection for any
   * missing capability). Takes precedence over `preferredMethods`.
   */
  methodAssignments?: Partial<Record<Capability, ProcessingMethod>>;
  optimizeFor: 'accuracy' | 'cost' | 'speed' | 'balanced';
  enableHybridRouting: boolean;
  /** Detected document languages (e.g. ['en'], ['ko'], ['nl']). Non-English excludes BDA/Textract methods. */
  documentLanguages?: string[];
}

export interface PipelineGenerateResponse {
  pipeline: PipelineDefinition;
  alternatives: PipelineDefinition[];
  rationale: string;
}

// ─── Pipeline Execution ───────────────────────────────────────────────────────

export type PipelineExecutionEvent =
  | { type: 'pipeline_start'; pipelineId: string }
  | { type: 'node_start'; nodeId: string; nodeType: PipelineNodeType }
  | { type: 'node_progress'; nodeId: string; progress: number; partial?: string }
  | { type: 'node_complete'; nodeId: string; result: unknown; metrics: { latencyMs: number; cost: number } }
  | { type: 'node_error'; nodeId: string; error: string }
  | { type: 'edge_active'; edgeId: string }
  | { type: 'pipeline_complete'; results: unknown; totalCost: number; totalLatencyMs: number }
  | { type: 'pipeline_error'; error: string };
