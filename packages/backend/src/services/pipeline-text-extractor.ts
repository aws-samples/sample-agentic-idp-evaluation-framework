import type { ProcessorResult } from '@idp/shared';

/**
 * Extracts a plain-text representation from an upstream method's results so it
 * can be fed into a downstream text-only stage (e.g. Bedrock Guardrails).
 *
 * Order of preference:
 *   1. Capabilities whose output is typically long-form text.
 *   2. Any capability with `data` — string preferred, otherwise JSON-stringified.
 *   3. `rawOutput` verbatim.
 *   4. Empty string.
 */
const TEXT_PREFERRED_CAPS = [
  'document_summarization',
  'text_extraction',
  'kv_extraction',
  'table_extraction',
  'entity_extraction',
];

function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return null; }
}

export function extractUpstreamText(result: ProcessorResult | undefined | null): string {
  if (!result) return '';
  const results = (result.results ?? {}) as Record<string, { data?: unknown } | undefined>;
  for (const cap of TEXT_PREFERRED_CAPS) {
    const text = asText(results[cap]?.data);
    if (text) return text;
  }
  for (const val of Object.values(results)) {
    const text = asText(val?.data);
    if (text) return text;
  }
  return result.rawOutput ?? '';
}

export function combineUpstreamText(results: Array<ProcessorResult | undefined | null>): string {
  return results
    .map((r) => extractUpstreamText(r))
    .filter((t) => t && t.length > 0)
    .join('\n\n');
}
