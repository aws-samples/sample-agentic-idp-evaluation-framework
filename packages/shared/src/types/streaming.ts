import type { Capability } from './capabilities.js';
import type { ProcessorResult, ComparisonResult, ProcessingMethod } from './processing.js';

// Conversation SSE events
export type ConversationEvent =
  | { type: 'text'; data: string }
  | { type: 'tool_use'; data: { name: string; input: unknown } }
  | { type: 'tool_result'; data: { name: string; result: unknown } }
  | { type: 'recommendation'; data: { capabilities: CapabilityRecommendation[]; documentLanguages?: string[] } }
  | { type: 'done' };

export interface CapabilityRecommendation {
  capability: Capability;
  relevance: number;
  rationale: string;
}

// Processing SSE events
export type ProcessingEvent =
  | { type: 'method_start'; method: ProcessingMethod }
  | { type: 'method_progress'; method: ProcessingMethod; data: { capability: string; progress: number; partial?: string } }
  | { type: 'method_complete'; method: ProcessingMethod; data: ProcessorResult }
  | { type: 'method_error'; method: ProcessingMethod; error: string }
  | { type: 'comparison_update'; data: ComparisonResult }
  | { type: 'all_complete'; data: { results: ProcessorResult[]; comparison: ComparisonResult } };

// Architecture SSE events
export type ArchitectureEvent =
  | { type: 'text'; data: string }
  | { type: 'diagram'; data: string }
  | { type: 'cost_projection'; data: CostProjection }
  | { type: 'done' };

export interface CostProjection {
  scale: string;
  docsPerMonth: number;
  methods: { method: ProcessingMethod; monthlyCost: number }[];
}
