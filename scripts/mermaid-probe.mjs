/**
 * Run candidate diagrams through the REAL Mermaid parser, in a real browser.
 *
 *   node scripts/mermaid-probe.mjs
 *
 * Why this exists: `sanitizeMermaid` was written against reasoning about Mermaid's
 * grammar rather than against Mermaid, and its first version introduced a fresh
 * corruption (`A["Textract (OCR")]`) that "looked right". Mermaid needs a DOM, so it
 * cannot be imported in the vitest/node environment — but Playwright ships Chromium,
 * so the parser can simply be asked.
 *
 * Prints, for every case: does the RAW source parse, and does the SANITIZED source
 * parse. That distinction is what matters —
 *   raw fail -> sanitized pass  = the fix works
 *   raw pass -> sanitized fail  = the sanitizer BROKE valid input (a regression)
 *   raw fail -> sanitized fail  = still unfixed
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

/**
 * The real sanitizeMermaid AND its helpers, read out of the component so the probe
 * cannot drift from what ships. Extracted by slicing between two markers rather than
 * matching one function: the implementation legitimately spans several top-level
 * declarations (the shape table, the character class, the scanner), and an earlier
 * single-function regex silently dropped them and threw "quoteNodeLabels is not
 * defined" instead of testing anything.
 */
const src = readFileSync('packages/frontend/src/components/common/MermaidDiagram.tsx', 'utf-8');
const start = src.indexOf('const SHAPES');
const end = src.indexOf('let counter = 0;');
if (start === -1 || end === -1) throw new Error('could not locate the sanitizer block in MermaidDiagram.tsx');
const sanitizeSource = src
  .slice(start, end)
  // Strip the TypeScript the browser cannot parse. Types only; no logic is touched.
  .replace(/export function/g, 'function')
  .replace(/ReadonlyArray<readonly \[string, string\]>/g, 'Array')
  // `x.at(-1) as string` — assertions must go before the parameter-type pass, or the
  // leftover `as string` reaches the browser and throws "Unexpected identifier 'as'".
  .replace(/ as [A-Za-z_$][\w$<>[\]|.]*/g, '')
  .replace(/function (\w+)\(([^)]*)\): \w+/g, (_m, name, params) => {
    const stripped = params
      .split(',')
      .map((p) => p.split(':')[0].trim())
      .filter(Boolean)
      .join(', ');
    return `function ${name}(${stripped})`;
  })
  .replace(/: (string|number|boolean)\b/g, '')
  .replace(/^const (SHAPES|NEEDS_QUOTING)[^=]*=/gm, 'const $1 =');

/**
 * Labels a model plausibly writes when asked to diagram this app's own pipeline.
 * Every one of these is a real shape from the architecture prompt's domain.
 */
const CASES = [
  ['plain', 'graph TD\n  A[Upload] --> B[Extract]'],
  ['fenced', '```mermaid\ngraph TD\n  A[Upload] --> B[Extract]\n```'],
  ['fence-bare', '```\ngraph TD\n  A[Upload] --> B[Extract]\n```'],
  ['parens-square', 'graph TD\n  A[Textract (OCR)] --> B[Claude]'],
  ['colon-square', 'graph TD\n  A[S3: uploads] --> B[Lambda]'],
  ['slash-square', 'graph TD\n  A[$0.0015/page] --> B[Done]'],
  ['ampersand-square', 'graph TD\n  A[Extract & Structure] --> B[Done]'],
  // Shapes the square-bracket-only rule cannot reach:
  ['parens-round', 'graph TD\n  A(Textract (OCR)) --> B[Claude]'],
  ['parens-stadium', 'graph TD\n  A([Textract (OCR)]) --> B[Claude]'],
  ['parens-rhombus', 'graph TD\n  A{Confidence (high)?} --> B[Done]'],
  ['parens-subroutine', 'graph TD\n  A[[Batch (async)]] --> B[Done]'],
  ['parens-cylinder', 'graph TD\n  A[(DynamoDB (results))] --> B[Done]'],
  ['subgraph-title', 'graph TD\n  subgraph Ingest (S3)\n    A[Upload]\n  end'],
  ['prose-preamble', "Here is the diagram:\n\ngraph TD\n  A[Upload] --> B[Extract]"],
  ['quote-in-label', 'graph TD\n  A["Textract (OCR)"] --> B[Claude]'],
  ['already-quoted-plus-parens', 'graph TD\n  A["S3: uploads"] --> B[Lambda (proc)]'],
  ['semicolons', 'graph TD;\n  A[Upload]-->B[Extract];'],
  ['end-as-id', 'graph TD\n  A[Upload] --> end'],
  ['br-in-label', 'graph TD\n  A[Textract<br/>OCR] --> B[Claude]'],
  ['percent-in-label', 'graph TD\n  A[98% confidence] --> B[Done]'],
  ['comma-in-label', 'graph TD\n  A[Sonnet 4.6, Haiku 4.5] --> B[Done]'],
  ['nested-square', 'graph TD\n  A[Bedrock [Converse]] --> B[Done]'],
  // Valid shapes that MUST survive untouched:
  ['valid-subroutine', 'graph TD\n  A[[Batch]] --> B[Done]'],
  ['valid-cylinder', 'graph TD\n  A[(Database)] --> B[Done]'],
  ['valid-stadium', 'graph TD\n  A([Start]) --> B[Done]'],
  ['valid-class', 'graph TD\n  A[Upload]:::hot --> B[Done]\n  classDef hot fill:#f96'],
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
// Pin the same major version the app bundles.
await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js' });
await page.evaluate(() => {
  window.mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    flowchart: { useMaxWidth: true, htmlLabels: false },
  });
});

const results = await page.evaluate(
  async ({ cases, sanitizeSource }) => {
    // eslint-disable-next-line no-new-func
    const sanitizeMermaid = new Function(`${sanitizeSource}; return sanitizeMermaid;`)();
    let n = 0;
    const out = [];
    for (const [name, chart] of cases) {
      const check = async (text) => {
        try {
          await window.mermaid.render(`probe-${++n}`, text);
          document.getElementById(`probe-${n}`)?.remove();
          return null;
        } catch (e) {
          document.getElementById(`probe-${n}`)?.remove();
          return String(e.message || e).split('\n')[0].slice(0, 110);
        }
      };
      const rawErr = await check(chart);
      const cleaned = sanitizeMermaid(chart);
      const sanErr = await check(cleaned);
      out.push({ name, rawOk: !rawErr, sanOk: !sanErr, rawErr, sanErr, cleaned });
    }
    return out;
  },
  { cases: CASES, sanitizeSource },
);

await browser.close();

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('case', 28), pad('raw', 6), pad('sanitized', 10), 'verdict');
console.log('-'.repeat(92));
const regressions = [];
const unfixed = [];
for (const r of results) {
  let verdict;
  if (r.rawOk && r.sanOk) verdict = 'ok (both parse)';
  else if (!r.rawOk && r.sanOk) verdict = 'FIXED by sanitizer';
  else if (r.rawOk && !r.sanOk) { verdict = `*** REGRESSION: ${r.sanErr}`; regressions.push(r); }
  else { verdict = `still broken: ${r.sanErr}`; unfixed.push(r); }
  console.log(pad(r.name, 28), pad(r.rawOk ? 'pass' : 'FAIL', 6), pad(r.sanOk ? 'pass' : 'FAIL', 10), verdict);
}

console.log(`\n${regressions.length} regression(s), ${unfixed.length} still broken`);
for (const r of regressions) {
  console.log(`\nREGRESSION ${r.name}\n  in:  ${JSON.stringify(r.cleaned)}\n  err: ${r.sanErr}`);
}
for (const r of unfixed) {
  console.log(`\nUNFIXED ${r.name}\n  out: ${JSON.stringify(r.cleaned)}\n  err: ${r.sanErr}`);
}
process.exit(regressions.length > 0 ? 1 : 0);
