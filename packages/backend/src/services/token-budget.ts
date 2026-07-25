/**
 * Dynamic maxTokens sizing based on document complexity.
 * Saves cost on simple documents while preventing truncation on complex ones.
 *
 * CachePoint ✓ and YAML ✓ are already implemented.
 * This is the 3rd cost optimization: response length optimization.
 */

import { catalogMaxOutputTokens } from '@idp/shared';

const MEDIA_CAPABILITIES = new Set([
  'video_summarization',
  'video_chapter_extraction',
  'audio_transcription',
  'audio_summarization',
  'content_moderation',
]);

export function isMediaCapability(cap: string): boolean {
  return MEDIA_CAPABILITIES.has(cap);
}

/**
 * Conservative ceiling for a model the catalog does not describe.
 *
 * Applies to the non-Converse entries — BDA, Guardrails, and the GPT tiers served
 * through Mantle — none of which publish an output ceiling in the Bedrock catalog.
 * 64,000 is the lowest ceiling among the Converse models we route to, so it is
 * safe for anything unknown.
 */
const DEFAULT_MODEL_MAX = 64_000;

/**
 * Output-token ceiling for a model. Requesting more than a model allows is a hard
 * ValidationException ("The maximum tokens you requested exceeds the model limit
 * of N"), so the budget must be clamped per model rather than to one constant.
 *
 * Ceilings come from the committed Bedrock catalog snapshot via generated code
 * (`MODEL_MAX_OUTPUT_TOKENS`), not from a hand-maintained map. The map here used
 * to be EMPTY, with a comment asserting "every model currently routed to accepts
 * 64,000" — true when written, but unverifiable without re-reading the docs by
 * hand, and it left the Opus tiers and Sonnet 5 bounded at 64,000 when they accept
 * 128,000. It is also one id away from a real trap: `amazon.nova-lite-v1:0`
 * (Nova 1, still in the catalog) caps at 5,120, so a future edit routing to it
 * would have requested 64,000 and failed outright.
 */
export function modelMaxOutputTokens(modelId?: string): number {
  return catalogMaxOutputTokens(modelId) ?? DEFAULT_MODEL_MAX;
}

/**
 * Apply a caller-supplied hard ceiling to a computed budget.
 *
 * The size-based budget is deliberately generous so full runs never truncate,
 * but that headroom also lets a model generate all the way to the ceiling. In
 * preview — where every method races in parallel and the user waits on the
 * slowest — that turned one method into a 161s stall (Nova 2 Lite emitted 16.6k
 * output tokens on a document it normally answers in ~5s). Callers that need a
 * bounded response pass a smaller cap; `undefined` keeps the full budget.
 */
export function applyOutputCap(budget: number, cap?: number): number {
  if (!cap || cap <= 0) return budget;
  return Math.min(budget, cap);
}

/**
 * Clamp a desired budget to a model ceiling. Split out from calculateMaxTokens
 * so the clamp behavior can be tested against an arbitrary ceiling without
 * needing a real constrained model in the catalog.
 */
export function clampToCeiling(desired: number, floor: number, ceiling: number): number {
  return Math.max(Math.min(floor, ceiling), Math.min(desired, ceiling));
}

/**
 * Calculate optimal maxTokens for a Bedrock extraction call.
 *
 * @param capCount - Number of capabilities being extracted
 * @param pageCount - Number of document pages
 * @param format - Output format ('yaml' saves ~30% tokens vs 'json')
 * @param isMedia - Whether this is a media processing task
 * @param modelId - Target model, used to clamp to that model's output ceiling
 * @returns maxTokens value clamped to the model's supported maximum
 *
 * Budget rationale:
 * - Table extraction for multi-page docs needs ~2000 tokens/page (HTML rows)
 * - Korean/CJK text uses ~1.5-2x more tokens than English
 * - Each capability adds ~4000 tokens (YAML wrapper + data)
 * - Min 16384 so even a single-capability single-page run cannot truncate
 *
 * These budgets are deliberately generous. maxTokens is an upper BOUND, not an
 * allocation: you are billed for tokens actually generated, so a high ceiling
 * costs nothing extra on short answers but prevents mid-table/mid-JSON
 * truncation on dense documents. Truncation is far more expensive than headroom
 * because it produces an unparseable result and the whole run is wasted.
 */
export function calculateMaxTokens(
  capCount: number,
  pageCount: number,
  format: 'yaml' | 'json' = 'yaml',
  isMedia: boolean = false,
  modelId?: string,
): number {
  // Clamp to what THIS model actually accepts.
  const ceiling = modelMaxOutputTokens(modelId);

  // Media capabilities (transcription, chaptering) produce long transcripts, so
  // they get a higher floor than document extraction.
  if (isMedia) {
    return clampToCeiling(capCount * 8000, 32768, ceiling);
  }

  const formatMult = format === 'yaml' ? 1.0 : 1.3;
  // Base: 4000 tokens per capability + 2000 per page (CJK/tables need headroom)
  const calculated = Math.round((4000 * capCount + pageCount * 2000) * formatMult);
  // Floor high enough that no realistic single-page extraction truncates.
  return clampToCeiling(calculated, 16384, ceiling);
}
