/**
 * Ask the LIVE deployment for architecture diagrams and check each one renders.
 *
 *   BASE=https://… node scripts/verify-live-diagram.mjs [rounds]
 *
 * `scripts/mermaid-probe.mjs` tests the sanitizer against shapes I chose. That proves the
 * repairs work, but not that the model's ACTUAL output survives them — and the model is
 * the input that matters. A diagram is generated fresh on every step-4 visit, so the only
 * honest test is to generate several and render each with the real parser.
 *
 * Calls /api/architecture directly (it streams `<diagram>` in an SSE `diagram` event),
 * then renders each captured source in Chromium through the shipped sanitizeMermaid.
 * Reports, per diagram, whether the RAW source parsed and whether the SANITIZED one did —
 * so a repair that is doing real work is visible, and so is one that breaks valid input.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const BASE = process.env.BASE;
if (!BASE) {
  console.error('BASE is required, e.g. BASE=https://xxx.cloudfront.net node scripts/verify-live-diagram.mjs');
  process.exit(2);
}
const ROUNDS = Number(process.argv[2] || 3);

/** A plausible step-4 request: several families, so the model names varied services. */
const body = {
  capabilities: ['text_extraction', 'table_extraction', 'kv_extraction'],
  processingResults: [
    { method: 'claude-haiku', status: 'complete', results: { text_extraction: { capability: 'text_extraction', data: 'x', confidence: 0.9, format: 'text' } }, metrics: { latencyMs: 1200, cost: 0.004 } },
    { method: 'textract-claude-haiku', status: 'complete', results: { table_extraction: { capability: 'table_extraction', data: [], confidence: 0.8, format: 'json' } }, metrics: { latencyMs: 2400, cost: 0.006 } },
    { method: 'bda-standard', status: 'complete', results: { kv_extraction: { capability: 'kv_extraction', data: {}, confidence: 0.7, format: 'json' } }, metrics: { latencyMs: 5000, cost: 0.01 } },
  ],
  comparison: { methods: [], recommendation: 'claude-haiku', capabilityMatrix: {} },
  pipeline: {
    name: 'Balanced-Optimized Pipeline',
    nodes: [{ id: 'm1', type: 'method', config: { method: 'claude-haiku', family: 'claude', capabilities: ['text_extraction'] } }],
    edges: [],
    estimatedCostPerPage: 0.0067,
    estimatedLatencyMs: 5000,
  },
};

/** Read the SSE stream and return every `diagram` payload it emitted. */
async function fetchDiagrams() {
  const res = await fetch(`${BASE}/api/architecture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const found = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        // Events are FLAT ({type, data}), not nested under `data.data` — assuming the
        // nested shape is what once made an e2e script report "0 completed" for every run.
        if (ev.type === 'diagram' && typeof ev.data === 'string') found.push(ev.data);
      } catch { /* keepalive or partial frame */ }
    }
  }
  return found;
}

/*
 * The shipped sanitizer, extracted from the component so this check cannot drift from
 * what users get. Compiled with the REAL TypeScript transpiler rather than regex-stripped:
 * hand-rolled annotation removal mangles `const NEEDS_QUOTING = /[()[\]{}:&]/` — the `:&`
 * inside the character class looks like a type annotation — which threw "Missing
 * initializer in const declaration" and had nothing to do with the code under test.
 */
const ts = (await import('typescript')).default;
const src = readFileSync('packages/frontend/src/components/common/MermaidDiagram.tsx', 'utf-8');
const a = src.indexOf('const SHAPES');
const b = src.indexOf('let counter = 0;');
const sanitizeSource = ts.transpileModule(
  src.slice(a, b).replace(/export function/g, 'function'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

console.log(`requesting ${ROUNDS} diagram(s) from ${BASE}\n`);
const diagrams = [];
for (let i = 0; i < ROUNDS; i++) {
  try {
    const d = await fetchDiagrams();
    if (d.length === 0) console.log(`  round ${i + 1}: no <diagram> in the response`);
    else { diagrams.push(...d); console.log(`  round ${i + 1}: ${d.length} diagram(s), ${d[0].length} chars`); }
  } catch (e) {
    console.log(`  round ${i + 1}: FAILED ${String(e.message).slice(0, 120)}`);
  }
}

if (diagrams.length === 0) {
  console.error('\nno diagrams captured — cannot verify rendering');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js' });
await page.evaluate(() => window.mermaid.initialize({
  startOnLoad: false, theme: 'default', securityLevel: 'strict',
  flowchart: { useMaxWidth: true, htmlLabels: false },
}));

const results = await page.evaluate(async ({ charts, sanitizeSource }) => {
  const sanitizeMermaid = new Function(`${sanitizeSource}; return sanitizeMermaid;`)();
  let n = 0;
  const out = [];
  for (const chart of charts) {
    const check = async (text) => {
      try {
        await window.mermaid.render(`live-${++n}`, text);
        document.getElementById(`live-${n}`)?.remove();
        return null;
      } catch (e) {
        document.getElementById(`live-${n}`)?.remove();
        return String(e.message || e).split('\n')[0].slice(0, 140);
      }
    };
    const rawErr = await check(chart);
    const sanErr = await check(sanitizeMermaid(chart));
    out.push({ rawOk: !rawErr, sanOk: !sanErr, sanErr, head: chart.split('\n')[0].slice(0, 60) });
  }
  return out;
}, { charts: diagrams, sanitizeSource });

await browser.close();

console.log('\nrendering the model\'s real output:');
let broken = 0;
let repaired = 0;
for (const [i, r] of results.entries()) {
  const verdict = r.sanOk
    ? (r.rawOk ? 'renders (needed no repair)' : 'REPAIRED by sanitizer')
    : `STILL BROKEN: ${r.sanErr}`;
  if (!r.sanOk) broken++;
  else if (!r.rawOk) repaired++;
  console.log(`  ${i + 1}. ${verdict}\n     first line: ${r.head}`);
}

console.log(`\n${diagrams.length} diagram(s): ${diagrams.length - broken} render, ${repaired} needed repair, ${broken} broken`);
if (broken > 0) {
  console.log('\nBroken sources, verbatim (feed these into scripts/mermaid-probe.mjs as cases):');
  results.forEach((r, i) => { if (!r.sanOk) console.log(`\n--- ${i + 1} ---\n${diagrams[i]}`); });
}
process.exit(broken > 0 ? 1 : 0);
