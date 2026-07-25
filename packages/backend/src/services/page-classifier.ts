import { PDFDocument } from 'pdf-lib';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, config } from '../config/aws.js';
import { buildInferenceConfig } from '../adapters/extraction-shared.js';

/**
 * Page classifier — the "hybrid routing" stage the pipeline canvas advertises.
 *
 * The generator emitted a Page Classifier node and the UI described it as
 * "Route by content type", but the executor never ran it: the node was purely
 * decorative. This performs the classification for real so the stage the user is
 * shown is the stage that runs.
 *
 * Classification is deliberately cheap — one small vision call over the whole
 * document rather than per page — because its only job is to say which pages
 * look table-heavy, form-like, image-only or plain text.
 */

export type PageContentType = 'table' | 'image' | 'text-only' | 'form' | 'mixed';

export interface PageClassification {
  /** 1-based page number. */
  page: number;
  contentType: PageContentType;
  /** Model's confidence in the label, 0-1. */
  confidence: number;
}

export interface ClassificationResult {
  pages: PageClassification[];
  /** Distinct content types present, useful for routing decisions. */
  contentTypes: PageContentType[];
  latencyMs: number;
  /** Set when classification could not run; callers should route unconditionally. */
  error?: string;
}

const VALID_TYPES: ReadonlySet<string> = new Set<PageContentType>([
  'table', 'image', 'text-only', 'form', 'mixed',
]);

const CLASSIFIER_PROMPT = `Classify each page of this document by its dominant content type.

Allowed types:
- "table"     — page is mostly tabular data
- "form"      — page is mostly labelled fields / key-value pairs
- "image"     — page is mostly photos, scans or diagrams with little text
- "text-only" — page is mostly running prose
- "mixed"     — no single type dominates

Return ONLY a JSON array, one entry per page, no prose and no code fences:
[{"page":1,"contentType":"table","confidence":0.9}]`;

/** Page count without fully parsing the document, for non-PDF inputs. */
export async function countPdfPages(buffer: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return 1;
  }
}

/**
 * Classify a document's pages by content type.
 *
 * Never throws: classification is an optimization, so a failure returns an
 * `error` and an empty page list, and the caller routes every page to the
 * default method rather than failing the run.
 */
export async function classifyPages(
  documentBuffer: Buffer,
  fileName: string,
  pageCount: number,
): Promise<ClassificationResult> {
  const start = Date.now();
  const isPdf = /\.pdf$/i.test(fileName);

  if (!isPdf) {
    // Single-asset inputs (an image, a converted Office doc) are one unit; there
    // is nothing to route between.
    return {
      pages: [{ page: 1, contentType: 'mixed', confidence: 0.5 }],
      contentTypes: ['mixed'],
      latencyMs: Date.now() - start,
    };
  }

  try {
    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: config.claudeModelId,
        system: [{ text: 'You classify document pages. Return only valid JSON.' }],
        messages: [
          {
            role: 'user',
            content: [
              { document: { name: 'document', format: 'pdf', source: { bytes: documentBuffer } } },
              { text: CLASSIFIER_PROMPT },
            ],
          },
        ],
        inferenceConfig: buildInferenceConfig(config.claudeModelId, 4096, 0),
      }),
    );

    const text = response.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
    const pages = parseClassification(text, pageCount);
    return {
      pages,
      contentTypes: [...new Set(pages.map((p) => p.contentType))],
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      pages: [],
      contentTypes: [],
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Classification failed',
    };
  }
}

/** Parse the model's JSON array, tolerating code fences and bad entries. */
export function parseClassification(raw: string, pageCount: number): PageClassification[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<number>();
  const out: PageClassification[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const page = Number(e.page);
    if (!Number.isInteger(page) || page < 1 || page > pageCount || seen.has(page)) continue;
    const type = String(e.contentType);
    if (!VALID_TYPES.has(type)) continue;
    const confidence = Number(e.confidence);
    seen.add(page);
    out.push({
      page,
      contentType: type as PageContentType,
      confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0.5,
    });
  }
  return out.sort((a, b) => a.page - b.page);
}

/**
 * Summary line for the pipeline event stream, e.g. "3 table, 1 text-only".
 * Empty string when nothing was classified.
 */
export function summarizeClassification(pages: readonly PageClassification[]): string {
  if (pages.length === 0) return '';
  const counts = new Map<PageContentType, number>();
  for (const p of pages) counts.set(p.contentType, (counts.get(p.contentType) ?? 0) + 1);
  return [...counts.entries()].map(([type, n]) => `${n} ${type}`).join(', ');
}
