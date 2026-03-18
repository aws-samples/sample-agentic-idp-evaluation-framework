/**
 * Output normalizer (#4)
 * Converts adapter outputs to UnifiedPageResult[] format.
 */
import type { UnifiedPageResult } from '@idp/shared';
import type { AdapterOutput } from '../adapters/stream-adapter.js';

/**
 * Normalize any adapter's output into a uniform page-level representation.
 * All methods produce different raw shapes; this normalizer creates a consistent view.
 */
export function normalizeOutput(
  output: AdapterOutput,
  method: string,
  pageCount: number = 1,
): UnifiedPageResult[] {
  const pages: UnifiedPageResult[] = [];

  // Try to extract structured data from results
  const results = output.results ?? {};

  for (let i = 0; i < pageCount; i++) {
    const page: UnifiedPageResult = {
      pageNumber: i + 1,
      text: '',
      tables: [],
      kvPairs: [],
      entities: [],
      metadata: { method, sourceFormat: 'normalized' },
    };

    // Extract text from results
    for (const [cap, capResult] of Object.entries(results)) {
      const data = (capResult as any)?.data;
      const confidence = (capResult as any)?.confidence ?? 0.5;

      if (!data) continue;

      switch (cap) {
        case 'text_extraction':
        case 'handwriting_extraction':
          page.text += typeof data === 'string' ? data : JSON.stringify(data);
          break;

        case 'table_extraction':
          if (Array.isArray(data)) {
            for (const table of data) {
              page.tables.push({
                rows: Array.isArray(table.rows) ? table.rows : [[String(table)]],
                confidence,
                caption: table.caption,
              });
            }
          } else if (typeof data === 'string') {
            // HTML table or CSV — store as single-cell
            page.tables.push({ rows: [[data]], confidence });
          }
          break;

        case 'kv_extraction':
          if (typeof data === 'object' && !Array.isArray(data)) {
            for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
              page.kvPairs.push({ key, value: String(value), confidence });
            }
          } else if (Array.isArray(data)) {
            for (const pair of data) {
              page.kvPairs.push({
                key: pair.key ?? pair.name ?? '',
                value: String(pair.value ?? ''),
                confidence: pair.confidence ?? confidence,
              });
            }
          }
          break;

        case 'entity_extraction':
          if (Array.isArray(data)) {
            for (const entity of data) {
              page.entities.push({
                type: entity.type ?? 'unknown',
                value: String(entity.value ?? entity.text ?? ''),
                confidence: entity.confidence ?? confidence,
              });
            }
          } else if (typeof data === 'object') {
            for (const [type, value] of Object.entries(data as Record<string, unknown>)) {
              page.entities.push({ type, value: String(value), confidence });
            }
          }
          break;

        default:
          // Store other capabilities in metadata
          page.metadata[cap] = { data, confidence };
          break;
      }
    }

    // If no text was extracted from specific capabilities, use raw output
    if (!page.text && output.rawOutput) {
      page.text = typeof output.rawOutput === 'string'
        ? output.rawOutput.slice(0, 5000) // Limit to prevent huge payloads
        : JSON.stringify(output.rawOutput).slice(0, 5000);
    }

    pages.push(page);
  }

  return pages;
}
