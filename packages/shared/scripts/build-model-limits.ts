/**
 * Generate src/generated/model-limits.ts from the committed Bedrock catalog snapshot.
 *
 * Why generate rather than import the snapshot: the snapshot is 274 KB of model
 * metadata, and the app consumes exactly one field from it — each model's output
 * ceiling. Importing the whole JSON would ship all of it to the browser bundle and
 * the Lambda/ECS image for the sake of ~20 numbers.
 *
 * Why generate rather than hand-maintain: `token-budget.ts` carried an EMPTY
 * `MODEL_MAX_OUTPUT_TOKENS` map behind a 64,000 default, with a comment claiming
 * "every model currently routed to accepts 64,000". That was true but lossy — the
 * Opus tiers and Sonnet 5 accept 128,000, so the budget silently capped them at
 * half their real ceiling, and the only way to notice was to re-check the docs by
 * hand. The catalog already knows.
 *
 * Only `maxOutputTokens` is generated. `maxInputTokens` in the snapshot is
 * free-form prose — "1M", "1 Million", "200k", "8,172 tokens", "Video: 6GB/" —
 * so parsing it into a number would mean guessing; a wrong input ceiling would
 * truncate real documents. Input budgeting stays where it is until the upstream
 * field is machine-readable.
 *
 *   npx tsx scripts/build-model-limits.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const SNAPSHOT = join(ROOT, 'data', 'bedrock-model-catalog.json');
const OUTPUT_DIR = join(ROOT, 'src', 'generated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'model-limits.ts');

interface CatalogModel {
  modelId?: string;
  context?: { maxOutputTokens?: number | null } | null;
}

const catalog = JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) as {
  lastUpdated?: string;
  models?: CatalogModel[];
};

const limits = new Map<string, number>();
let skipped = 0;

for (const model of catalog.models ?? []) {
  const id = model.modelId;
  const max = model.context?.maxOutputTokens;
  // A model id is a catalog-supplied string that becomes a key in generated
  // source. Accept only the shape Bedrock actually uses, so nothing can smuggle
  // a quote or a newline into the emitted object literal.
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    skipped++;
    continue;
  }
  // Null/absent means the catalog does not know. Recording a 0 or a guess would
  // be worse than falling back to the documented default at call time.
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) {
    skipped++;
    continue;
  }
  limits.set(id, Math.floor(max));
}

const sorted = [...limits.entries()].sort(([a], [b]) => a.localeCompare(b));

const body = sorted.map(([id, max]) => `  '${id}': ${max},`).join('\n');

const output = `/**
 * Per-model output-token ceilings, generated from the Bedrock catalog snapshot.
 *
 * DO NOT EDIT — regenerate with \`npx tsx scripts/build-model-limits.ts\`.
 * Source: packages/shared/data/bedrock-model-catalog.json (lastUpdated ${catalog.lastUpdated ?? 'unknown'}).
 *
 * Requesting more output tokens than a model allows is a hard ValidationException
 * ("The maximum tokens you requested exceeds the model limit of N"), so a budget
 * must be clamped per model. ${sorted.length} models carry a known ceiling here;
 * ${skipped} catalog entries do not publish one and fall back to the caller's default.
 */

export const MODEL_MAX_OUTPUT_TOKENS: Readonly<Record<string, number>> = {
${body}
};

/**
 * Output ceiling for a model id, or \`undefined\` when the catalog does not know.
 *
 * Accepts the cross-region inference profile form our METHOD_INFO uses
 * ("us.anthropic.claude-opus-5") as well as the bare catalog id, and tolerates a
 * version suffix (":0"), because the same model is named all three ways across
 * the SDK, the catalog, and our own config.
 */
export function catalogMaxOutputTokens(modelId?: string): number | undefined {
  if (!modelId) return undefined;
  const candidates = [
    modelId,
    modelId.replace(/^us\\./, ''),
    modelId.split(':')[0],
    modelId.replace(/^us\\./, '').split(':')[0],
  ];
  for (const candidate of candidates) {
    const hit = MODEL_MAX_OUTPUT_TOKENS[candidate];
    if (hit !== undefined) return hit;
  }
  return undefined;
}
`;

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_FILE, output);
console.log(
  `Generated ${sorted.length} model output limits (${skipped} entries had none) → ${OUTPUT_FILE}`,
);
