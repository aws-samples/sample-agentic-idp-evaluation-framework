/**
 * Drive the deployed app through steps 1-4 in a real browser, as a first-time user.
 *
 *   BASE=https://… node scripts/ux-walkthrough.mjs [document.pdf]
 *
 * Two jobs, deliberately combined so the evidence and the demo cannot drift apart:
 *
 *  1. AUDIT. Screenshots every step, captures console errors, failed network
 *     requests and unhandled rejections, and reports any text the page shows that
 *     contradicts the catalog. Static reading cannot see a tooltip clipped by a
 *     table or a panel that renders empty because a fetch 404'd.
 *  2. CAPTURE. Records the session to video (`--record`) so the README animation is
 *     the real UI, not a mock. Because it is the same run that audits, a broken
 *     screen shows up in the recording rather than being quietly cropped out.
 *
 * Runs against a deployment; it never needs local credentials, because everything
 * it exercises is reachable through the public site.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

const BASE = process.env.BASE;
if (!BASE) {
  console.error('BASE is required, e.g. BASE=https://xxx.cloudfront.net node scripts/ux-walkthrough.mjs');
  process.exit(2);
}
const DOC = process.argv[2] || '/tmp/idp-corpus/en-invoice.pdf';
const OUT = process.env.OUT || '/tmp/idp-ux';
const RECORD = process.argv.includes('--record') || process.env.RECORD === '1';
/** Slow the pointer down so a recording is watchable rather than a blur. */
const CINEMATIC = RECORD;

mkdirSync(OUT, { recursive: true });

/** Everything the browser complained about, per step. */
const problems = [];
const note = (step, kind, detail) => {
  problems.push({ step, kind, detail });
  console.log(`  [${kind}] ${detail}`);
};

const shots = [];
async function shot(page, name, label) {
  const file = join(OUT, `${String(shots.length + 1).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push({ file, name, label });
  console.log(`  shot -> ${basename(file)}`);
}

/** Wait for the network to settle, but never hang a whole run on one slow call. */
async function settle(page, ms = 2500) {
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {});
  await page.waitForTimeout(CINEMATIC ? 900 : 250);
}

/**
 * Click the first locator that exists, reporting which one matched.
 * The UI has several equivalent affordances per step (a card, a button, a nav
 * item); pinning one selector makes the walkthrough brittle for no benefit.
 */
async function clickAny(page, step, candidates, what) {
  for (const sel of candidates) {
    const loc = typeof sel === 'string' ? page.locator(sel) : sel;
    const n = await loc.count().catch(() => 0);
    if (n === 0) continue;
    const first = loc.first();
    if (!(await first.isVisible().catch(() => false))) continue;
    await first.scrollIntoViewIfNeeded().catch(() => {});
    if (CINEMATIC) await page.waitForTimeout(500);
    await first.click({ timeout: 8000 }).catch((e) => note(step, 'click-failed', `${what}: ${e.message.split('\n')[0]}`));
    return true;
  }
  note(step, 'missing-control', `no control found for: ${what}`);
  return false;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  ...(RECORD ? { recordVideo: { dir: join(OUT, 'video'), size: { width: 1600, height: 1000 } } } : {}),
});
const page = await context.newPage();

let currentStep = 'boot';
page.on('console', (m) => {
  if (m.type() !== 'error' && m.type() !== 'warning') return;
  const t = m.text();
  // React's dev-only key warnings and Cloudscape's own deprecations are noise here.
  if (/Download the React DevTools|was preloaded using link preload/i.test(t)) return;
  note(currentStep, m.type() === 'error' ? 'console-error' : 'console-warning', t.slice(0, 300));
});
page.on('pageerror', (e) => note(currentStep, 'page-error', String(e).slice(0, 300)));
page.on('requestfailed', (r) => {
  const f = r.failure();
  note(currentStep, 'request-failed', `${r.method()} ${r.url().replace(BASE, '')} - ${f?.errorText}`);
});
page.on('response', (r) => {
  if (r.status() >= 400 && r.url().startsWith(BASE)) {
    // 403 on /api/runs is the deliberate run-history lockdown, not a fault.
    if (r.status() === 403 && /\/api\/runs/.test(r.url())) return;
    note(currentStep, 'http-error', `${r.status()} ${r.url().replace(BASE, '')}`);
  }
});

const report = { base: BASE, doc: DOC, steps: {} };

try {
  // ─── Step 1: the first screen ────────────────────────────────────────────
  currentStep = 'step1-landing';
  console.log(`\n[step 1] landing: ${BASE}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle(page, 8000);
  await shot(page, 'step1-landing', 'Step 1 — Upload a document');

  const title = await page.title();
  const bodyText = await page.locator('body').innerText().catch(() => '');
  report.steps.step1 = { title, textLength: bodyText.length };
  console.log(`  <title> = ${title}`);

  // The bug the user caught: a header count that disagrees with the list below it.
  for (const m of bodyText.matchAll(/(\d+)\s+(?:processing\s+)?methods?\b/gi)) {
    if (Number(m[1]) !== 29) note('step1-landing', 'stale-count', `page says "${m[0]}" (catalog has 29)`);
  }
  for (const m of bodyText.matchAll(/(\d+)\s+capabilit/gi)) {
    if (Number(m[1]) !== 33) note('step1-landing', 'stale-count', `page says "${m[0]}" (catalog has 33)`);
  }
  for (const m of bodyText.matchAll(/(\d+)[-\s]step/gi)) {
    if (Number(m[1]) !== 4) note('step1-landing', 'stale-count', `page says "${m[0]}" (there are 4 steps)`);
  }
  for (const bad of ['undefined', 'NaN', '[object Object]', 'TODO', 'Lorem ipsum', 'coming soon']) {
    if (bodyText.includes(bad)) note('step1-landing', 'placeholder-text', `visible text contains "${bad}"`);
  }

  // How many of the 29 methods are actually named on the first screen?
  const named = await page.evaluate(() => document.body.innerText);
  report.steps.step1.methodNamesOnPage = named.split('\n').filter((l) => /claude|nova|textract|bda|gpt|pegasus|ocr/i.test(l)).length;

  if (!existsSync(DOC)) {
    note('step1-landing', 'skipped', `document not found: ${DOC} - stopping after step 1`);
  } else {
    // ─── Upload ────────────────────────────────────────────────────────────
    console.log(`\n[step 1] upload ${basename(DOC)}`);
    const input = page.locator('input[type=file]');
    if ((await input.count()) === 0) {
      note('step1-landing', 'missing-control', 'no <input type=file> on the landing page');
    } else {
      await input.first().setInputFiles(DOC);
      await settle(page, 20000);
      await shot(page, 'step1-uploaded', 'Document uploaded');

      // ─── Step 2: analyse & preview ───────────────────────────────────────
      currentStep = 'step2-preview';
      console.log('\n[step 2] analyse & preview');
      /*
       * The file input only STAGES the document; "Upload and Analyze" is what
       * actually uploads it and advances the workflow. Skipping it left step 2 on
       * "Nothing to show yet" — which looked like a broken deployment but was the
       * app correctly refusing to analyse a document it had never received.
       */
      await clickAny(page, currentStep, [
        'button:has-text("Upload and Analyze")',
        'button:has-text("Upload and analyze")',
      ], 'upload the staged document');
      // The upload POST plus the advisor's first turn; both must land before step 2
      // has anything to render.
      await page.waitForURL(/\/conversation/, { timeout: 60000 }).catch(() =>
        note(currentStep, 'no-auto-advance', 'upload did not navigate to step 2 within 60s'));
      await settle(page, 30000);
      await shot(page, 'step2-analyze', 'Step 2 — Compare methods on your document');

      /*
       * The advisor interview gates the preview, and "Skip questions, use defaults"
       * is DISABLED until the first analysis turn lands — so clicking it immediately
       * times out. Wait for it to become enabled, which is also the honest measure of
       * how long a user waits before they are allowed to skip.
       */
      const skip = page.locator('button:has-text("Skip questions"), button:has-text("Skip")').first();
      await skip.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
      const enabledAt = Date.now();
      await page
        .waitForFunction(
          () => {
            const b = [...document.querySelectorAll('button')].find((x) => /skip/i.test(x.textContent || ''));
            return b && !b.disabled;
          },
          { timeout: 120000 },
        )
        .catch(() => note(currentStep, 'gate-stuck', 'the Skip button never became enabled within 120s'));
      report.skipEnabledAfterMs = Date.now() - enabledAt;
      await clickAny(page, currentStep, [
        'button:has-text("Skip questions")',
        'button:has-text("Skip")',
      ], 'skip the interview and use defaults');
      await settle(page, 15000);
      // Whatever the skip produced, the preview still needs starting on some builds.
      await clickAny(page, currentStep, [
        'button:has-text("Run preview")',
        'button:has-text("Run comparison")',
        'button:has-text("Compare methods")',
        'button:has-text("Compare")',
      ], 'start the preview run').catch(() => {});
      await page.waitForTimeout(CINEMATIC ? 6000 : 3000);
      await shot(page, 'step2-preview-running', 'Methods running in parallel');

      // Give the fan-out real time; it is minutes on a big document.
      const deadline = Date.now() + Number(process.env.PREVIEW_WAIT_MS || 150000);
      let lastSeen = -1;
      while (Date.now() < deadline) {
        const t = await page.locator('body').innerText().catch(() => '');
        const done = (t.match(/\$\d+\.\d{3,4}/g) || []).length;
        if (done !== lastSeen) { lastSeen = done; console.log(`  …${done} priced results so far`); }
        if (/Comparison|Extracted output|Final result/i.test(t) && done >= 3) break;
        await page.waitForTimeout(4000);
      }
      await settle(page, 5000);
      await shot(page, 'step2-comparison', 'Side-by-side comparison');

      const step2Text = await page.locator('body').innerText().catch(() => '');
      report.steps.step2 = {
        pricedResults: (step2Text.match(/\$\d+\.\d{3,4}/g) || []).length,
        sawTruncationWarning: /cut off|truncat/i.test(step2Text),
        sawError: /failed|error/i.test(step2Text),
      };
      // Raw identifiers leaking into the UI - the user should see labels, not enum keys.
      for (const key of ['text_extraction', 'table_extraction', 'kv_extraction', 'bounding_box']) {
        if (step2Text.includes(key)) note(currentStep, 'raw-identifier', `capability key "${key}" shown to the user verbatim`);
      }

      // ─── Step 3: pipeline ────────────────────────────────────────────────
      currentStep = 'step3-pipeline';
      console.log('\n[step 3] pipeline');
      /*
       * Navigate the way a user does — click the nav item — rather than page.goto().
       * A full reload is a different code path (it rehydrates from localStorage) and
       * would hide a state-handoff bug between steps, which is exactly what this
       * walkthrough exists to catch.
       */
      await clickAny(page, currentStep, [
        'a:has-text("3. Build Pipeline")',
        'a[href="/pipeline"]',
        'button:has-text("Build pipeline")',
      ], 'navigate to step 3');
      await settle(page, 25000);
      await shot(page, 'step3-pipeline', 'Step 3 — Your recommended pipeline');

      const step3Text = await page.locator('body').innerText().catch(() => '');
      report.steps.step3 = {
        hasCanvas: (await page.locator('.react-flow, [class*=reactflow]').count()) > 0,
        looksEmpty: /no pipeline|nothing to show|No items/i.test(step3Text),
      };
      if (report.steps.step3.looksEmpty) note(currentStep, 'empty-state', 'pipeline page renders an empty state after a completed preview');

      await clickAny(page, currentStep, ['button:has-text("Execute")', 'button:has-text("Run pipeline")'], 'execute the pipeline');
      await page.waitForTimeout(CINEMATIC ? 9000 : 5000);
      await shot(page, 'step3-executing', 'Pipeline executing');

      // ─── Step 4: architecture ────────────────────────────────────────────
      currentStep = 'step4-architecture';
      console.log('\n[step 4] architecture + code');
      await clickAny(page, currentStep, [
        'a:has-text("4. Architecture")',
        'a[href="/architecture"]',
      ], 'navigate to step 4');
      await settle(page, 30000);
      // The diagram is generated, so it can take a while to arrive.
      await page.waitForTimeout(CINEMATIC ? 12000 : 8000);
      await shot(page, 'step4-architecture', 'Step 4 — Deployable architecture');

      const step4Text = await page.locator('body').innerText().catch(() => '');
      const svgCount = await page.locator('svg[id^=mermaid], .mermaid svg, [data-testid=arch-diagram] svg').count();
      report.steps.step4 = {
        mermaidSvgRendered: svgCount,
        diagramError: /Diagram failed|Syntax error|No diagram type/i.test(step4Text),
      };
      if (report.steps.step4.diagramError) note(currentStep, 'diagram-error', 'the architecture diagram failed to render');
      if (svgCount === 0 && !report.steps.step4.diagramError) note(currentStep, 'diagram-missing', 'no rendered diagram and no error shown - silent blank');

      await clickAny(page, currentStep, ['button:has-text("Terraform")', '[role=tab]:has-text("Terraform")'], 'show the Terraform output');
      await settle(page, 4000);
      await shot(page, 'step4-code', 'Generated Terraform / CDK');
    }
  }

  // ─── Docs, the other thing a newcomer opens ──────────────────────────────
  currentStep = 'docs';
  console.log('\n[docs] checking served docs for stale claims');
  await page.goto(`${BASE}/docs`, { waitUntil: 'domcontentloaded' });
  await settle(page, 8000);
  await shot(page, 'docs', 'Documentation');
  const docsText = await page.locator('body').innerText().catch(() => '');
  if (/App Runner/i.test(docsText)) note('docs', 'wrong-info', 'docs still describe an App Runner backend (it is ECS Fargate behind an ALB)');
  for (const m of docsText.matchAll(/(\d+)\s+methods?\b/gi)) {
    if (Number(m[1]) !== 29) note('docs', 'stale-count', `docs say "${m[0]}" (catalog has 29)`);
  }
} catch (err) {
  note(currentStep, 'fatal', String(err).slice(0, 400));
} finally {
  await page.waitForTimeout(1200);
  await context.close();
  await browser.close();
}

const videoDir = join(OUT, 'video');
report.problems = problems;
report.shots = shots.map((s) => ({ file: s.file, label: s.label }));
if (RECORD && existsSync(videoDir)) report.video = videoDir;
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));

console.log(`\n─── summary ───`);
console.log(`screenshots: ${shots.length} in ${OUT}`);
if (RECORD) console.log(`video:       ${videoDir}`);
const byKind = {};
for (const p of problems) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
console.log(`problems:    ${problems.length}`, byKind);
for (const p of problems) console.log(`  ${p.step} [${p.kind}] ${p.detail}`);
console.log(`\nreport: ${join(OUT, 'report.json')}`);
