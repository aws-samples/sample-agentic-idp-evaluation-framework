/**
 * Measure extraction ACCURACY against a corpus with known ground truth, per method.
 *
 *   BASE=https://… node scripts/e2e-corpus.mjs /path/to/corpus
 *
 * Why this exists: `e2e-live.mjs` proves the pipeline RUNS — status codes, non-zero
 * costs, parallel fan-out. It cannot tell you whether the extraction was right, and
 * the app's own ranking uses each model's SELF-REPORTED confidence, which is a
 * number the model invents about itself. This script scores what actually came back
 * against tokens we know are in the document, so "Nova is fast" and "Nova is
 * correct" stop being the same claim.
 *
 * It found real bugs on first run: a method can report `status: complete` with a
 * healthy confidence and still have recovered almost none of the document.
 *
 * Ground truth is deliberately token-recall, not exact match: models legitimately
 * reformat, translate labels, and reorder. Recall of known-present strings is the
 * strongest signal available without a per-field schema, and it never rewards
 * hallucination — a made-up value cannot match a token that is really there.
 */
import { readFileSync, readdirSync } from 'fs';
import { basename, join, extname } from 'path';

const BASE = process.env.BASE;
if (!BASE) {
  // Deliberately generic: this script is committed to a public repo, so it must not
  // carry a specific deployment's hostname. Get yours from the stack output:
  //   cd infrastructure && terraform output -raw site_url
  console.error('BASE is required, e.g. BASE=https://<your-distribution>.cloudfront.net');
  process.exit(2);
}
const CORPUS = process.argv[2] || '/tmp/idp-corpus';

/**
 * Tokens that verifiably appear in each document, by file stem.
 *
 * Chosen to be unambiguous: identifiers, amounts and dates rather than common
 * words, so a match cannot happen by chance. Korean entries mix Hangul and digits
 * because CJK tokenisation differs per model and a digits-only check would pass
 * even if the Hangul were mangled.
 */
const GROUND_TRUTH = {
  'en-invoice': {
    capabilities: ['text_extraction', 'table_extraction', 'kv_extraction'],
    tokens: [
      'INV-88421', 'Northwind', 'Contoso', 'PO-55190', '2026-03-14', '2026-04-13',
      'A-1001', 'A-1002', 'B-2200', 'C-3010',
      '240', '480', '36', '12',
      '204.00', '57.60', '522.00', '780.00',
      '1563.60', '128.99', '1692.59',
    ],
  },
  'ko-quotation': {
    capabilities: ['text_extraction', 'table_extraction', 'kv_extraction'],
    tokens: [
      'QT-2026-0417', '대한정밀기계', '서울전자', '김민수',
      'K-1001', 'K-1002', 'K-2200', 'K-3010',
      '베어링', '오일', '브라켓', '조립',
      '1020000', '288000', '696000', '1040000',
      '3044000', '304400', '3348400',
    ],
  },
  'en-contract': {
    capabilities: ['text_extraction', 'entity_extraction', 'document_summarization'],
    tokens: [
      'SA-7734', 'Aperture', 'Globex', '2026-02-01', '2028-01-31',
      '18,500', 'Delaware', 'twenty-four', 'ninety', 'forty-five',
    ],
  },
};

/** Everything the model returned, flattened to one lowercase haystack. */
function haystack(result) {
  const parts = [result.rawOutput ?? ''];
  for (const cap of Object.values(result.results ?? {})) {
    parts.push(typeof cap.data === 'string' ? cap.data : JSON.stringify(cap.data ?? ''));
  }
  return parts.join('\n').toLowerCase();
}

function scoreRecall(result, tokens) {
  const hay = haystack(result);
  const found = tokens.filter((t) => hay.includes(String(t).toLowerCase()));
  return { found: found.length, total: tokens.length, missing: tokens.filter((t) => !found.includes(t)) };
}

async function upload(file) {
  const body = new FormData();
  body.append('file', new Blob([readFileSync(file)]), basename(file));
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body });
  if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Read an SSE stream to completion, returning every parsed event. */
async function sse(path, payload, timeoutMs = 600_000) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const events = [];
  let buf = '';
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString('utf-8');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { events.push(JSON.parse(line.slice(6))); } catch { /* partial frame */ }
    }
  }
  return events;
}

const files = readdirSync(CORPUS)
  .filter((f) => ['.pdf', '.png', '.jpg', '.mp4'].includes(extname(f).toLowerCase()))
  .filter((f) => GROUND_TRUTH[basename(f, extname(f))]);

if (files.length === 0) {
  console.error(`no scorable files in ${CORPUS} (need one of: ${Object.keys(GROUND_TRUTH).join(', ')})`);
  process.exit(2);
}

console.log(`corpus: ${files.length} document(s) against ${BASE}\n`);

const rows = [];
let failures = 0;

for (const file of files) {
  const stem = basename(file, extname(file));
  const truth = GROUND_TRUTH[stem];
  const doc = await upload(join(CORPUS, file));
  console.log(`── ${stem} (${doc.documentType}, ${doc.pageCount}p) caps=${truth.capabilities.join(',')}`);

  const events = await sse('/api/preview', {
    documentId: doc.documentId,
    s3Uri: doc.s3Uri,
    fileName: doc.fileName,
    documentType: doc.documentType,
    capabilities: truth.capabilities,
    pageCount: doc.pageCount,
  });

  /*
   * `method_result` events are FLAT — method/status/results/latencyMs/estimatedCost
   * sit at the top level, not under a nested `data`. Reading `e.data.status` scored
   * every document as 0 completions, which looked exactly like a broken deployment;
   * the shape came from the live stream, not from a guess.
   */
  const results = events.filter((e) => e.type === 'method_result' && e.status === 'complete');
  const errors = events.filter((e) => e.type === 'method_error');

  for (const r of results) {
    const s = scoreRecall(r, truth.tokens);
    const pct = Math.round((s.found / s.total) * 100);
    // Per-capability confidences are the only self-report on the wire here.
    const confs = Object.values(r.results ?? {})
      .map((c) => c?.confidence)
      .filter((c) => typeof c === 'number');
    rows.push({
      doc: stem,
      method: r.method,
      recall: pct,
      selfConfidence: confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100) : null,
      ocr: r.ocrConfidence != null ? Math.round(r.ocrConfidence * 100) : null,
      latencyMs: r.latencyMs,
      cost: r.estimatedCost,
      missing: s.missing,
    });
  }
  for (const e of errors) {
    console.log(`   ERROR ${e.method}: ${String(e.error).slice(0, 90)}`);
  }
  console.log(`   ${results.length} completed, ${errors.length} errored\n`);
}

// Sorted by measured recall, which is the ordering the app itself cannot produce.
rows.sort((a, b) => b.recall - a.recall || (a.latencyMs ?? 0) - (b.latencyMs ?? 0));

console.log('doc'.padEnd(14) + 'method'.padEnd(24) + 'recall'.padStart(7)
  + 'self'.padStart(6) + 'ocr'.padStart(6) + 'latency'.padStart(9) + 'cost'.padStart(10));
for (const r of rows) {
  console.log(
    r.doc.padEnd(14) + r.method.padEnd(24)
    + `${r.recall}%`.padStart(7)
    + (r.selfConfidence == null ? '-' : `${r.selfConfidence}%`).padStart(6)
    + (r.ocr == null ? '-' : `${r.ocr}%`).padStart(6)
    + `${r.latencyMs}ms`.padStart(9)
    + `$${(r.cost ?? 0).toFixed(4)}`.padStart(10),
  );
}

/*
 * The finding this script exists to surface: a method whose self-reported
 * confidence is high while its measured recall is poor. That is precisely the case
 * the app's own ranking cannot see, because it ranks on the self-report.
 */
console.log('\n── overconfident methods (self-report >= 80% but recall < 60%)');
const overconfident = rows.filter((r) => (r.selfConfidence ?? 0) >= 80 && r.recall < 60);
if (overconfident.length === 0) {
  console.log('   none');
} else {
  for (const r of overconfident) {
    failures++;
    console.log(`   ${r.doc}/${r.method}: claims ${r.selfConfidence}%, recovered ${r.recall}%`);
    console.log(`      missing: ${r.missing.slice(0, 8).join(', ')}${r.missing.length > 8 ? ` (+${r.missing.length - 8})` : ''}`);
  }
}

console.log('\n── per-document best');
for (const doc of [...new Set(rows.map((r) => r.doc))]) {
  const best = rows.filter((r) => r.doc === doc)[0];
  console.log(`   ${doc}: ${best.method} at ${best.recall}% recall, ${best.latencyMs}ms, $${(best.cost ?? 0).toFixed(4)}`);
}

process.exit(failures > 0 ? 1 : 0);
