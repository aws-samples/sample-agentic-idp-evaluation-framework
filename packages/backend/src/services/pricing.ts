import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO, TEXTRACT_PAGE_PRICING } from '@idp/shared';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Per-page infrastructure fee charged *in addition to* LLM tokens.
 *
 * The hybrid families are two-stage: a managed extractor does OCR, then an LLM
 * structures its text output. Both stages bill. The UI has always advertised
 * this correctly ("Textract $0.0015/pg + $3/$15 MTok", "BDA $0.01/pg + tokens")
 * but `calculateCost` returned the token cost alone whenever token usage was
 * reported, so every hybrid run under-reported its true cost — and did so
 * silently, which is worse than being wrong loudly: Txt+Nova 2 Lite looked
 * ~5x cheaper than it is and would win a cost comparison it should lose.
 */
const PER_PAGE_INFRA_FEE: Partial<Record<string, number>> = {
  // The two-phase adapter calls DetectDocumentText (plain OCR), NOT
  // AnalyzeDocument — see two-phase-adapter.ts, which builds a
  // DetectDocumentTextCommand because the LLM does the structuring. Using the
  // AnalyzeDocument price here would over-report by up to 40x, just as using the
  // OCR price for Guardrails (which does call AnalyzeDocument with FORMS)
  // under-reported it.
  'textract-llm': TEXTRACT_PAGE_PRICING.detectText,
  // Bedrock Data Automation standard output, per page.
  'bda-llm': 0.01,
};

/** Cents-level rounding. 4 decimals ≈ $0.0001, the smallest amount worth showing. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Cost of one run of `method` over `pageCount` pages.
 *
 * Uses measured token usage when the adapter reports it, and adds the per-page
 * fee for any stage that bills outside the token stream (Textract OCR, BDA).
 * Methods that report no token usage (BDA Standard, Guardrails) fall back to
 * their per-page estimate.
 */
export function calculateCost(
  method: ProcessingMethod,
  pageCount: number,
  tokenUsage?: TokenUsage,
  /**
   * Per-page infrastructure fee measured by the adapter for this specific run.
   * Overrides the family default, because the Textract stage's price depends on
   * which features were requested ($0.0015/page plain OCR up to $0.065/page for
   * TABLES+FORMS) — a single per-family constant cannot express that.
   */
  perPageFee?: number,
): number {
  const info = METHOD_INFO[method];
  if (!info) return 0;

  const pages = Math.max(1, pageCount || 1);
  const feePerPage = perPageFee ?? PER_PAGE_INFRA_FEE[info.family] ?? 0;

  // Token-based pricing for LLM methods (Claude, Nova, GPT, BDA+LLM, Textract+LLM).
  if (tokenUsage && info.tokenPricing) {
    const inputCost = (tokenUsage.inputTokens / 1_000_000) * info.tokenPricing.inputPer1MTokens;
    const outputCost = (tokenUsage.outputTokens / 1_000_000) * info.tokenPricing.outputPer1MTokens;
    // The OCR/extraction stage of a hybrid method bills per page, outside the
    // token stream, so it has to be added explicitly.
    return round4(inputCost + outputCost + feePerPage * pages);
  }

  // Per-page pricing for methods with no token stream (BDA Standard, Guardrails).
  //
  // Rounded to 4 decimals like the token branch. It was previously rounded to 3,
  // which floored Guardrails ($0.0016/page) to $0.002 and — for any method under
  // $0.0005/page, such as Nova Embeddings — collapsed the cost to exactly $0.00,
  // displaying "free" for a method that bills.
  return round4(info.estimatedCostPerPage * pages);
}

export function estimateMonthlyCost(
  method: ProcessingMethod,
  docsPerMonth: number,
  avgPagesPerDoc: number,
): number {
  const totalPages = docsPerMonth * avgPagesPerDoc;
  return calculateCost(method, totalPages);
}
