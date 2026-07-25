/**
 * Screenshot the landing page's method catalog from a locally built bundle.
 *
 *   node scripts/shoot-catalog.mjs http://localhost:5199 /tmp/catalog.png
 *
 * A layout claim ("this is easier to scan") is only worth making after looking at the
 * pixels. This renders the real built app so the panel can be reviewed before deploying,
 * and it also asserts the two things that were actually broken and are invisible to a
 * type checker: a family heading rendering as `undefined`, and the same unavailable
 * reason repeated once per row.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5199';
const OUT = process.argv[3] || '/tmp/catalog.png';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 2 });

/*
 * The catalog reads live availability from /api/methods, which a static preview does not
 * serve. Stub it with this deployment's real shape — all six SageMaker OCR models
 * unavailable for the SAME reason — because that is precisely the case the old layout
 * rendered badly.
 */
// Shape must match what useMethodAvailability reads: { methods: [{ id, available,
// unavailableDetail }] }. A stub with the wrong keys renders every method as available
// and silently hides the states this screenshot exists to check.
await page.route('**/api/methods', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      methods: [
        { id: 'bda-custom', available: false, unavailableDetail: 'Needs a custom blueprint project, which is not configured.' },
        { id: 'nova-embeddings', available: false, unavailableDetail: 'Nova Multimodal Embeddings is only offered in us-east-1; this deployment runs in us-west-2.' },
        ...['infinity-parser2', 'baidu-ocr', 'surya-ocr', 'chandra-ocr', 'dots-ocr', 'qwen3-vl'].map((m) => ({
          id: `sagemaker-${m}`,
          available: false,
          unavailableDetail: 'Needs a self-hosted SageMaker endpoint, which is not deployed here.',
        })),
      ],
    }),
  }),
);
await page.route('**/api/health/features', (route) =>
  route.fulfill({ contentType: 'application/json', body: '{"runHistoryDisabled":true}' }),
);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

/*
 * The panel is folded by default (it is a reference table, not the landing task), so it
 * has to be expanded before it can be photographed or asserted on.
 */
const panel = page.locator('text=Processing methods').first();
await panel.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
await panel.click().catch(() => {});
await page.waitForTimeout(1200);

const text = await page.locator('body').innerText();

// The bugs the screenshot is meant to prove gone.
const problems = [];
if (/\bundefined\b/.test(text)) problems.push('a heading or label rendered as "undefined"');
const repeats = (text.match(/Needs a self-hosted SageMaker endpoint/g) || []).length;
if (repeats > 1) problems.push(`the shared SageMaker reason is repeated ${repeats}x (should be 1)`);
for (const family of ['TwelveLabs Pegasus', 'Specialist OCR (self-hosted)']) {
  if (!text.includes(family)) problems.push(`family heading missing: ${family}`);
}

/*
 * Climb from the header to the ancestor that actually contains the whole panel.
 * `locator('div', {has: text})` returned the innermost match — the header itself — so the
 * screenshot was one line of text rather than the layout under review.
 */
const clip = await page.evaluate(() => {
  const header = [...document.querySelectorAll('*')].find(
    (el) => el.textContent?.trim().startsWith('Processing methods') && el.children.length <= 3,
  );
  if (!header) return null;
  let node = header;
  // Walk up until the element is tall enough to be the panel, not the heading.
  while (node.parentElement && node.getBoundingClientRect().height < 500) node = node.parentElement;
  const r = node.getBoundingClientRect();
  return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
});

if (clip && clip.height > 500) {
  await page.screenshot({ path: OUT, clip, fullPage: true });
} else {
  await page.screenshot({ path: OUT, fullPage: true });
}

await browser.close();

console.log(`screenshot: ${OUT}`);
console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'checks passed: named families, reason stated once, no "undefined"');
process.exit(problems.length ? 1 : 0);
