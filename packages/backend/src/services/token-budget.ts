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
 * Calculate optimal maxTokens for a Bedrock extraction call.
 *
 * @param capCount - Number of capabilities being extracted
 * @param pageCount - Number of document pages
 * @param format - Output format ('yaml' saves ~30% tokens vs 'json')
 * @param isMedia - Whether this is a media processing task
 * @returns maxTokens value clamped between MIN and MAX
 *
 * Budget rationale:
 * - Table extraction for multi-page docs needs ~1000 tokens/page (HTML rows)
 * - Korean/CJK text uses ~1.5-2x more tokens than English
 * - Each capability adds ~1000 tokens (YAML wrapper + data)
 * - Min 4096 to handle any single-page document comfortably
 */
export function calculateMaxTokens(
  capCount: number,
  pageCount: number,
  format: 'yaml' | 'json' = 'yaml',
  isMedia: boolean = false,
): number {
  // Model max output tokens (minimum across all models: Haiku 4.5 = 64,000)
  const MODEL_MAX = 64000;

  // Media capabilities need more tokens (video transcription, audio, etc.)
  if (isMedia) return Math.max(8192, Math.min(capCount * 2000, MODEL_MAX));

  const formatMult = format === 'yaml' ? 1.0 : 1.3;
  // Base: 1000 tokens per capability + 800 per page (CJK/tables need more headroom)
  const calculated = Math.round((1000 * capCount + pageCount * 800) * formatMult);
  return Math.max(4096, Math.min(calculated, MODEL_MAX));
}
