import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Calculate cost from actual token usage if available, otherwise fallback to per-page estimate */
export function calculateCost(
  method: ProcessingMethod,
  pageCount: number,
  tokenUsage?: TokenUsage,
): number {
  const info = METHOD_INFO[method];

  // Token-based pricing for LLM methods (Claude, Nova, BDA+LLM, Textract+LLM)
  if (tokenUsage && info.tokenPricing) {
    const inputCost = (tokenUsage.inputTokens / 1_000_000) * info.tokenPricing.inputPer1MTokens;
    const outputCost = (tokenUsage.outputTokens / 1_000_000) * info.tokenPricing.outputPer1MTokens;
    return Math.round((inputCost + outputCost) * 10000) / 10000;
  }

  // Per-page pricing for BDA Standard, Textract (no token usage)
  return Math.round(info.estimatedCostPerPage * pageCount * 1000) / 1000;
}

export function estimateMonthlyCost(
  method: ProcessingMethod,
  docsPerMonth: number,
  avgPagesPerDoc: number,
): number {
  const totalPages = docsPerMonth * avgPagesPerDoc;
  return calculateCost(method, totalPages);
}
