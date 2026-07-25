/**
 * Refresh packages/shared/data/bedrock-model-catalog.json and report every place
 * where METHOD_INFO disagrees with the live Bedrock model catalog.
 *
 *   node scripts/sync-model-catalog.mjs          # report only
 *   node scripts/sync-model-catalog.mjs --write  # also rewrite the snapshot
 *
 * Why this exists: METHOD_INFO hardcodes token prices, and hardcoded prices rot.
 * The first run of this check found NINE of our 22 methods priced wrong — Nova was
 * 2x over, every GPT tier ~10% under, Sonnet 5 50% over — which directly corrupts
 * the cost comparison this whole tool exists to provide.
 *
 * Source: set `MODEL_CATALOG_URL` to a catalog endpoint that exposes the fields the AWS
 * SDK drops (pricing, media support, per-region availability). Unofficial by nature, so
 * treat it as a cross-check a human reviews — never as something that silently rewrites
 * prices in CI.
 *
 * The URL is NOT hardcoded: it previously pointed at an internal host containing a
 * personal alias, in a public repository, where it was both a needless disclosure and
 * unreachable for anyone who cloned this. With the variable unset the script simply
 * reports against the committed snapshot, which is the useful default.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'packages/shared/data/bedrock-model-catalog.json');
const SOURCE = process.env.MODEL_CATALOG_URL ?? '';

const write = process.argv.includes('--write');

const { METHODS, METHOD_INFO } = await import(
  join(ROOT, 'packages/shared/dist/index.js')
);

let catalog;
if (!SOURCE) {
  // The common case for anyone who cloned this: report against what is committed.
  console.log('MODEL_CATALOG_URL not set — checking against the committed snapshot.');
  catalog = JSON.parse(readFileSync(SNAPSHOT, 'utf-8'));
} else {
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    catalog = await res.json();
    console.log(`fetched ${catalog.models.length} models (updated ${catalog.lastUpdated})`);
  } catch (err) {
    console.warn(`could not reach the catalog (${err.message}); using the committed snapshot`);
    catalog = JSON.parse(readFileSync(SNAPSHOT, 'utf-8'));
  }
}

const byId = new Map(catalog.models.map((m) => [m.modelId, m]));

/**
 * Our modelId may be a cross-region inference profile ("us.anthropic.…") or carry
 * a version suffix, while the catalog keys on the bare model id.
 */
function lookup(modelId) {
  const candidates = [
    modelId,
    modelId.replace(/^us\./, ''),
    modelId.split(':')[0],
    modelId.replace(/^us\./, '').split(':')[0],
  ];
  for (const c of candidates) if (byId.has(c)) return byId.get(c);
  return undefined;
}

/** Catalog prices are USD per 1K tokens; METHOD_INFO uses per 1M. */
const per1M = (v) => (typeof v === 'number' ? Math.round(v * 1000 * 10_000) / 10_000 : undefined);

const mismatches = [];
const missing = [];

for (const method of METHODS) {
  const info = METHOD_INFO[method];
  const hit = lookup(info.modelId);
  if (!hit) {
    // BDA and Guardrails are services, not foundation models — absence is correct.
    missing.push({ method, modelId: info.modelId });
    continue;
  }
  const catIn = per1M(hit.pricing?.inputTokenPrice);
  const catOut = per1M(hit.pricing?.outputTokenPrice);
  const ourIn = info.tokenPricing.inputPer1MTokens;
  const ourOut = info.tokenPricing.outputPer1MTokens;
  const off = (a, b) => a !== undefined && Math.abs(a - b) > 0.001;
  if (off(catIn, ourIn) || off(catOut, ourOut)) {
    mismatches.push({ method, ourIn, ourOut, catIn, catOut });
  }
}

console.log(`\n${mismatches.length} price mismatch(es):`);
for (const m of mismatches) {
  console.log(
    `  ${m.method.padEnd(24)} ours ${String(m.ourIn).padStart(6)}/${String(m.ourOut).padEnd(6)}`
    + ` catalog ${String(m.catIn).padStart(6)}/${m.catOut}`,
  );
}

console.log(`\n${missing.length} method(s) absent from the catalog (expected for non-FM services):`);
for (const m of missing) console.log(`  ${m.method.padEnd(24)} ${m.modelId}`);

// Models that accept video, so new candidates are visible rather than guessed at.
const video = catalog.models.filter((m) => {
  const inputs = (m.modalities?.input ?? []).map((x) => String(x).toUpperCase());
  return inputs.includes('VIDEO') || !!m.mediaSupport?.video;
});
console.log(`\n${video.length} catalog model(s) accept video input:`);
for (const m of video) console.log(`  ${m.modelId}`);

if (write && !SOURCE) {
  console.error('--write needs MODEL_CATALOG_URL; refusing to rewrite the snapshot with itself.');
  process.exit(2);
}
if (write) {
  const trimmed = {
    _source: SOURCE || '(committed snapshot; set MODEL_CATALOG_URL to refresh)',
    _note: JSON.parse(readFileSync(SNAPSHOT, 'utf-8'))._note,
    lastUpdated: catalog.lastUpdated,
    totalModels: catalog.totalModels ?? catalog.models.length,
    models: catalog.models.map((m) => ({
      modelId: m.modelId,
      modelName: m.modelName,
      providerName: m.providerName,
      modelFamily: m.modelFamily,
      modalities: { input: m.modalities?.input, output: m.modalities?.output },
      mediaSupport: m.mediaSupport,
      context: m.context,
      capabilities: m.capabilities,
      pricing: {
        inputTokenPrice: m.pricing?.inputTokenPrice,
        outputTokenPrice: m.pricing?.outputTokenPrice,
      },
      availableRegions: m.availableRegions,
      mantle: m.mantle,
    })),
  };
  writeFileSync(SNAPSHOT, `${JSON.stringify(trimmed, null, 2)}\n`);
  console.log(`\nwrote ${SNAPSHOT}`);
}

// Non-zero exit on mismatch so this can gate a release check, but only when asked
// for explicitly — an unofficial upstream should not break an unrelated build.
if (mismatches.length > 0 && process.argv.includes('--strict')) process.exit(1);
