/**
 * Dynamic maxTokens sizing based on document complexity.
 * Saves cost on simple documents while preventing truncation on complex ones.
 *
 * CachePoint ✓ and YAML ✓ are already implemented.
 * This is the 3rd cost optimization: response length optimization.
 */

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
 * Per-model output-token ceilings, verified live against Bedrock Converse
 * (us-west-2). Requesting more than a model allows is a hard ValidationException
 * ("The maximum tokens you requested exceeds the model limit of N"), so the
 * budget must be clamped per model rather than to one global constant.
 *
 * Nova Pro is the outlier at 10,000. Every other model we route to accepts
 * 64,000. Models absent from this map fall back to DEFAULT_MODEL_MAX.
 */
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  'us.amazon.nova-pro-v1:0': 10_000,
};

const DEFAULT_MODEL_MAX = 64_000;

export function modelMaxOutputTokens(modelId?: string): number {
  if (!modelId) return DEFAULT_MODEL_MAX;
  return MODEL_MAX_OUTPUT_TOKENS[modelId] ?? DEFAULT_MODEL_MAX;
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
  // Clamp to what THIS model actually accepts (Nova Pro allows only 10k).
  const modelMax = modelMaxOutputTokens(modelId);

  // Floor high enough that no realistic single-page extraction truncates, but
  // never above the model ceiling.
  const minTokens = Math.min(16384, modelMax);

  // Media capabilities (transcription, chaptering) produce long transcripts.
  if (isMedia) {
    return Math.min(Math.max(Math.min(32768, modelMax), capCount * 8000), modelMax);
  }

  const formatMult = format === 'yaml' ? 1.0 : 1.3;
  // Base: 4000 tokens per capability + 2000 per page (CJK/tables need headroom)
  const calculated = Math.round((4000 * capCount + pageCount * 2000) * formatMult);
  return Math.max(minTokens, Math.min(calculated, modelMax));
}
