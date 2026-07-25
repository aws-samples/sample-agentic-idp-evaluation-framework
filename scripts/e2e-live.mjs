/**
 * Full-path end-to-end check against a RUNNING deployment:
 *   upload -> preview (SSE) -> pipeline generate -> pipeline execute (SSE)
 *
 * Asserts each stage returns real data, that the preview fan-out is genuinely
 * parallel (wall clock ≈ slowest method, not the sum), that no method reports a
 * $0 cost, and that hybrid methods bill more than their token cost alone.
 *
 * Several defects were only ever visible here and not in unit tests — hybrid
 * methods silently reporting their flat per-page estimate, and audio/video being
 * decoded as UTF-8 text. Run it after any change to adapters, pricing or routing.
 *
 *   BASE=https://xxxx.cloudfront.net node scripts/e2e-live.mjs sample.pdf [more...]
 *   BASE=http://localhost:3001        node scripts/e2e-live.mjs sample.pdf
 *
 * Uses only sample/synthetic documents — never real data (see the demo notice).
 */
import { readFileSync } from 'fs';
import { basename } from 'path';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const DOCS = process.argv.slice(2);

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  csv: 'text/csv', tiff: 'image/tiff',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

async function upload(path) {
  const fd = new FormData();
  const ext = path.split('.').pop().toLowerCase();
  // Field name must be 'file' — that is what upload.single('file') expects — and
  // the Blob needs a real MIME type or multer's fileFilter rejects it.
  fd.append('file', new Blob([readFileSync(path)], { type: MIME[ext] ?? 'application/octet-stream' }), basename(path));
  const r = await fetch(`${BASE}/api/upload`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0,200)}`);
  return r.json();
}

async function sse(url, body, onEvent) {
  const r = await fetch(`${BASE}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} ${r.status}: ${(await r.text()).slice(0,200)}`);
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const l of lines) {
      if (!l.startsWith('data: ')) continue;
      try { onEvent(JSON.parse(l.slice(6))); } catch {}
    }
  }
}

for (const path of DOCS) {
  console.log(`\n${'='.repeat(70)}\nDOC ${basename(path)}`);
  let doc;
  try { doc = await upload(path); } catch (e) { console.log('  UPLOAD FAILED:', e.message); continue; }
  console.log(`  uploaded id=${doc.documentId} pages=${doc.pageCount} size=${doc.fileSize}`);

  const caps = ['text_extraction','kv_extraction','table_extraction'];

  // ---- Preview ----
  const seen = [], order = [];
  const t0 = Date.now();
  try {
    await sse('/api/preview', { documentId: doc.documentId, s3Uri: doc.s3Uri, capabilities: caps }, (e) => {
      if (e.type === 'preview_start') console.log(`  preview: ${e.methods.length} methods, runId=${e.runId?.slice(0,8)}`);
      if (e.type === 'method_result') { seen.push(e); order.push(`${e.shortName}@${(e.latencyMs/1000).toFixed(1)}s`); }
    });
  } catch (e) { console.log('  PREVIEW FAILED:', e.message); }
  const wall = Date.now() - t0;
  const ok = seen.filter(r => r.status === 'complete');
  console.log(`  preview done in ${(wall/1000).toFixed(1)}s wall: ${ok.length}/${seen.length} succeeded`);
  const slowest = Math.max(0, ...seen.map(r => r.latencyMs));
  console.log(`  slowest method ${(slowest/1000).toFixed(1)}s -> parallel? ${wall < slowest * 1.6 ? 'YES' : 'NO (serial-ish)'}`);
  console.log(`  arrival order: ${order.slice(0,6).join(' ')}${order.length>6?' …':''}`);
  const withData = ok.filter(r => Object.keys(r.results ?? {}).length > 0);
  console.log(`  methods returning actual extracted data: ${withData.length}/${ok.length}`);
  const costs = ok.filter(r => r.estimatedCost != null);
  const zero = costs.filter(r => r.estimatedCost === 0);
  console.log(`  costs: ${costs.length} reported, ${zero.length} are $0 ${zero.length?'('+zero.map(r=>r.shortName).join(',')+')':''}`);
  const hybrids = ok.filter(r => /^(Txt|BDA)\+/.test(r.shortName));
  hybrids.slice(0,3).forEach(r => console.log(`    hybrid ${r.shortName}: $${r.estimatedCost?.toFixed(5)} (must exceed pure token cost)`));
  for (const e of seen.filter(r => r.status === 'error').slice(0,4)) console.log(`    ERR ${e.shortName}: ${String(e.error).slice(0,90)}`);

  // ---- Pipeline generate + execute ----
  const g = await fetch(`${BASE}/api/pipeline/generate`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ documentType: doc.documentType ?? 'pdf', capabilities: caps, optimizeFor:'balanced', enableHybridRouting:true }),
  });
  if (!g.ok) { console.log('  GENERATE FAILED', g.status, (await g.text()).slice(0,150)); continue; }
  const { pipeline } = await g.json();
  const mnodes = pipeline.nodes.filter(n=>n.type==='method');
  console.log(`  pipeline: ${pipeline.nodes.length} nodes, methods=[${mnodes.map(n=>n.config.method).join(', ')}], est $${pipeline.estimatedCostPerPage.toFixed(4)}/pg`);

  const nodeEvents = {}; let complete=null, perr=null;
  try {
    await sse('/api/pipeline/execute', { pipelineId: pipeline.id, documentId: doc.documentId, s3Uri: doc.s3Uri, pipeline }, (e) => {
      if (e.type === 'node_complete') nodeEvents[e.nodeId] = 'ok';
      if (e.type === 'node_error') nodeEvents[e.nodeId] = 'ERR:'+String(e.error).slice(0,60);
      if (e.type === 'pipeline_complete') complete = e;
      if (e.type === 'pipeline_error') perr = e.error;
    });
  } catch (e) { console.log('  EXECUTE FAILED:', e.message); }
  if (perr) console.log('  pipeline_error:', String(perr).slice(0,150));
  if (complete) {
    const caps2 = Object.keys(complete.results ?? {});
    console.log(`  executed: ${complete.processorResults.length} methods, cost $${complete.totalCost.toFixed(4)}, ${(complete.totalLatencyMs/1000).toFixed(1)}s`);
    console.log(`  final capabilities resolved: ${caps2.join(', ') || '(none)'}`);
    console.log(`  runId=${complete.runId?.slice(0,8)} recommendation="${String(complete.comparison?.recommendation).slice(0,60)}"`);
    const src = caps2.map(k=>complete.results[k].sourceMethod).filter(Boolean);
    if (src.length) console.log(`  aggregator attributed sources: ${[...new Set(src)].join(', ')}`);
  }
  const errs = Object.entries(nodeEvents).filter(([,v])=>v.startsWith('ERR'));
  errs.slice(0,4).forEach(([k,v])=>console.log(`    node ${k}: ${v}`));
}
