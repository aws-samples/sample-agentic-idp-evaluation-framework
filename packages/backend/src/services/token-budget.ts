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
 * Examples:
 *   3 caps, 1 page, yaml  -> 750
 *   5 caps, 2 pages, yaml -> 1300
 *   15 caps, 10 pages, json -> 4096 (capped)
 *   media, 2 caps -> 2048 (media floor)
 */
export function calculateMaxTokens(
  capCount: number,
  pageCount: number,
  format: 'yaml' | 'json' = 'yaml',
  isMedia: boolean = false,
): number {
  // Media capabilities need more tokens (video transcription, audio, etc.)
  if (isMedia) return Math.max(2048, Math.min(capCount * 500, 4096));

  const formatMult = format === 'yaml' ? 1.0 : 1.3;
  const calculated = Math.round((200 * capCount + pageCount * 150) * formatMult);
  return Math.max(512, Math.min(calculated, 4096));
}
