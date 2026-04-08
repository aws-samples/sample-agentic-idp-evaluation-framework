import { CAPABILITIES, type Capability, type CapabilityRecommendation } from '@idp/shared';
import type { DocumentAnalysis } from './analyze-document.js';

export interface LLMRecommendation {
  capability: string;
  relevance: number;
  rationale: string;
}

/**
 * Validate and enrich LLM-provided capability recommendations.
 * The LLM determines relevance based on full conversation context;
 * this function validates capability IDs, clamps scores, and optionally
 * boosts relevance when document analysis confirms structural signals.
 */
export function validateRecommendations(
  llmRecommendations: LLMRecommendation[],
  analysis: DocumentAnalysis,
): CapabilityRecommendation[] {
  const validCaps = new Set<string>(CAPABILITIES);

  return llmRecommendations
    .filter((rec) => validCaps.has(rec.capability))
    .map((rec) => {
      let relevance = Math.max(0, Math.min(1, rec.relevance));

      // Boost when document analysis confirms structural signals
      if (rec.capability === 'table_extraction' && analysis.hasTablesDetected) {
        relevance = Math.max(relevance, 0.95);
      }
      if (rec.capability === 'kv_extraction' && analysis.hasFormsDetected) {
        relevance = Math.max(relevance, 0.9);
      }
      if (rec.capability === 'image_description' && analysis.hasImagesDetected) {
        relevance = Math.max(relevance, 0.85);
      }
      if (rec.capability === 'handwriting_extraction' && analysis.hasHandwriting) {
        relevance = Math.max(relevance, 0.9);
      }

      return {
        capability: rec.capability as Capability,
        relevance,
        rationale: rec.rationale,
      };
    })
    .sort((a, b) => b.relevance - a.relevance);
}
