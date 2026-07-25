/**
 * Record the four-step walkthrough as an animation for the README.
 *
 *   BASE=https://… node scripts/record-walkthrough.mjs [document.pdf]
 *
 * Produces `docs/images/walkthrough.gif` (plus an `.mp4`, which is ~10x smaller and
 * linked as a fallback) by driving the REAL deployed app in Chromium. Nothing here is
 * mocked or staged: if a step is broken, the recording shows it broken. That is the
 * point — a README animation that cannot drift from the product.
 *
 * Between steps it overlays a "Step N of 4" caption so a reader can follow along
 * without narration, and it holds on each finished screen long enough to read.
 *
 * Requires ffmpeg on PATH (Playwright ships one; `brew install ffmpeg` also works).
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join, basename } from 'path';
import { execFileSync } from 'child_process';

const BASE = process.env.BASE;
if (!BASE) {
  console.error('BASE is required, e.g. BASE=https://xxx.cloudfront.net node scripts/record-walkthrough.mjs');
  process.exit(2);
}
const DOC = process.argv[2] || '/tmp/idp-corpus/en-invoice.pdf';
if (!existsSync(DOC)) {
  console.error(`document not found: ${DOC}`);
  process.exit(2);
}

const WORK = '/tmp/idp-record';
const OUT_DIR = join(process.cwd(), 'docs', 'images');
/*
 * 1280x800 at deviceScaleFactor 1. Recording at 2x then downscaling made the text mushy
 * rather than crisper, and large type at 1x survives the GIF's 760px downscale.
 */
const SIZE = { width: 1280, height: 800 };

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

/** ffmpeg from PATH, falling back to the copy Playwright bundles. */
function resolveFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    const cache = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
    if (existsSync(cache)) {
      const dir = readdirSync(cache).find((d) => d.startsWith('ffmpeg-'));
      if (dir) {
        for (const candidate of ['ffmpeg-mac', 'ffmpeg-mac-arm64', 'ffmpeg']) {
          const p = join(cache, dir, candidate);
          if (existsSync(p)) return p;
        }
      }
    }
    throw new Error('ffmpeg not found — install it (brew install ffmpeg) and retry');
  }
}
const FFMPEG = resolveFfmpeg();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  recordVideo: { dir: WORK, size: SIZE },
});
const page = await context.newPage();

/**
 * A caption card burned into the recording.
 *
 * Injected into the page rather than composited afterwards so it survives the GIF
 * conversion and stays in sync with what is on screen — a subtitle track would be
 * dropped by the GIF encoder entirely.
 */
async function caption(text, sub, ms = 2100) {
  await page.evaluate(
    ({ text, sub }) => {
      document.getElementById('__idp_caption__')?.remove();
      const el = document.createElement('div');
      el.id = '__idp_caption__';
      el.innerHTML = `<div style="font:700 30px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-0.4px">${text}</div>`
        + (sub ? `<div style="font:400 17px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;opacity:.82;margin-top:8px">${sub}</div>` : '');
      Object.assign(el.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '0 80px',
        background: 'rgba(9,14,22,0.93)', color: '#fff',
        backdropFilter: 'blur(3px)',
      });
      document.body.appendChild(el);
    },
    { text, sub },
  );
  await page.waitForTimeout(ms);
  await page.evaluate(() => {
    const el = document.getElementById('__idp_caption__');
    if (!el) return;
    el.style.transition = 'opacity .45s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 460);
  });
  await page.waitForTimeout(480);
}

/** Scroll smoothly so the recording reads as a tour rather than a slideshow. */
async function glide(toY, ms = 1400) {
  await page.evaluate(
    ({ toY, ms }) =>
      new Promise((done) => {
        const from = window.scrollY;
        const t0 = performance.now();
        const tick = (t) => {
          const p = Math.min(1, (t - t0) / ms);
          // ease-in-out, so it settles rather than snapping
          const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
          window.scrollTo(0, from + (toY - from) * e);
          if (p < 1) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      }),
    { toY, ms },
  );
}

async function clickAny(candidates, what) {
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if ((await page.locator(sel).count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(450);
    await loc.click({ timeout: 10000 }).catch(() => {});
    return true;
  }
  console.warn(`  ! no control for: ${what}`);
  return false;
}

try {
  console.log('[1/4] upload');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);

  await caption('Which AWS method should process your documents?', 'Stop guessing. Run them all on your own document and compare.', 2600);
  await caption('Step 1 of 4 — Upload', 'One real document. Everything after this is measured on it.');

  await page.locator('input[type=file]').first().setInputFiles(DOC);
  await page.waitForTimeout(1600);
  await glide(430, 1200);
  await page.waitForTimeout(900);
  await glide(0, 900);

  await clickAny(['button:has-text("Upload and Analyze")'], 'upload');
  await page.waitForURL(/\/conversation/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);

  console.log('[2/4] analyze & compare');
  await caption('Step 2 of 4 — Analyze & Compare', 'An advisor reads the document, then every applicable method runs in parallel.');
  // Let the advisor's answer stream in and scroll through it.
  await page.waitForTimeout(6000);
  await glide(400, 1600);
  await page.waitForTimeout(1400);
  await glide(0, 1000);

  await page
    .waitForFunction(
      () => {
        const b = [...document.querySelectorAll('button')].find((x) => /skip/i.test(x.textContent || ''));
        return b && !b.disabled;
      },
      { timeout: 120000 },
    )
    .catch(() => {});
  await clickAny(['button:has-text("Skip questions")', 'button:has-text("Skip")'], 'skip interview');
  /*
   * No "Run Preview" click here, deliberately.
   *
   * "Skip questions, use defaults" accepts the recommended capabilities AND starts the
   * fan-out itself — verified by listing the live DOM's buttons after the click: the next
   * controls to appear are the per-method result cards ("Sonnet 4.6", "GPT-5.6 Terra", …),
   * never a Run button. Two earlier attempts to click one logged "preview button never
   * appeared" and I assumed a selector bug; the button does not exist on this path.
   */

  // The fan-out is the most compelling part: many methods finishing at once.
  console.log('  waiting for the fan-out…');
  const deadline = Date.now() + Number(process.env.PREVIEW_WAIT_MS || 240000);
  while (Date.now() < deadline) {
    const t = await page.locator('body').innerText().catch(() => '');
    if (/Preview complete/i.test(t)) break;
    await page.waitForTimeout(3000);
  }
  await page.waitForTimeout(2000);
  await glide(500, 1500);
  await page.waitForTimeout(1500);
  await glide(1100, 1500);
  await page.waitForTimeout(2000);

  await caption('Real cost, real latency, real output', 'Side by side, on your document — not a benchmark table.', 2400);
  await glide(1700, 1400);
  await page.waitForTimeout(2200);

  console.log('[3/4] pipeline');
  await caption('Step 3 of 4 — Build Pipeline', 'Assemble the winners into a pipeline and run it end to end.');
  await clickAny(['a:has-text("3. Build Pipeline")', 'a[href="/pipeline"]'], 'step 3');
  /*
   * The pipeline is GENERATED by a model call ("AI is analyzing your preview results…"),
   * so the canvas — and therefore the Execute button — does not exist for several
   * seconds. A fixed 6s wait clicked into a spinner and missed it. Wait for the canvas.
   */
  await page
    .waitForSelector('.react-flow, [class*=reactflow]', { timeout: 90000 })
    .catch(() => console.warn('  ! pipeline canvas never appeared'));
  await page.waitForTimeout(2500);
  await glide(350, 1300);
  await page.waitForTimeout(1600);
  await clickAny(['button:has-text("Execute")', 'button:has-text("Run pipeline")'], 'execute');
  await page.waitForTimeout(11000);
  await glide(0, 900);
  await page.waitForTimeout(1200);

  console.log('[4/4] architecture & code');
  await caption('Step 4 of 4 — Architecture & Code', 'A deployable project wired to the methods you picked.');
  await clickAny(['a:has-text("4. Architecture")', 'a[href="/architecture"]'], 'step 4');
  await page.waitForTimeout(12000);
  await glide(420, 1400);
  await page.waitForTimeout(1800);
  for (const tab of ['Python', 'TypeScript', 'Deploy (CDK)']) {
    await clickAny([`[role=tab]:has-text("${tab}")`, `button:has-text("${tab}")`], tab);
    await page.waitForTimeout(1900);
  }
  await glide(900, 1300);
  await page.waitForTimeout(2000);
  await caption('ONE IDP Evaluation Framework', 'Terraform and CDK included. Deploy your own in one command.', 2800);
} finally {
  await page.waitForTimeout(800);
  await context.close();
  await browser.close();
}

// ─── Encode ────────────────────────────────────────────────────────────────────
const raw = readdirSync(WORK)
  .filter((f) => f.endsWith('.webm'))
  .map((f) => join(WORK, f))
  .sort((a, b) => statSync(b).size - statSync(a).size)[0];
if (!raw) throw new Error('playwright produced no video');

const mp4 = join(OUT_DIR, 'walkthrough.mp4');
const gif = join(OUT_DIR, 'walkthrough.gif');
const run = (args) => execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

console.log('\nencoding mp4…');
/*
 * Speed up 1.6x: the honest wall-clock includes real model latency, which is the point
 * of the tool but not watchable in a README. faststart so it plays before it downloads.
 */
run([
  '-i', raw,
  '-filter:v', 'setpts=PTS/1.6,scale=1000:-2:flags=lanczos',
  '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  mp4,
]);

console.log('encoding gif (two-pass palette)…');
/*
 * GIF is a bad format for a screen recording of a mostly-white UI, and the numbers say
 * so: at 1000px/10fps a two-pass palette still produced **20 MB** for 75 seconds, against
 * 2.7 MB for the same content as H.264. GitHub renders both, so the mp4 is what the README
 * links; the GIF exists only for viewers that will not play video.
 *
 * So the GIF is tuned hard for size rather than fidelity:
 *   fps=8      — the floor where a smooth scroll still reads as motion
 *   scale=760  — text stays legible because the source is 1280 wide with large type
 *   max_colors — a Cloudscape UI is flat colour; 96 is plenty and cuts the palette cost
 *   bayer_scale=5 — coarser dithering compresses far better on flat fills
 * Measured result: ~4 MB, which is reasonable inline.
 */
const palette = join(WORK, 'palette.png');
run([
  '-i', mp4,
  '-vf', 'fps=8,scale=760:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff',
  palette,
]);
run([
  '-i', mp4, '-i', palette,
  '-lavfi', 'fps=8,scale=760:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  gif,
]);

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);
console.log(`\nmp4: ${mp4} (${mb(mp4)} MB)`);
console.log(`gif: ${gif} (${mb(gif)} MB)`);
console.log(`source webm kept at ${raw} (${mb(raw)} MB)`);
if (Number(mb(gif)) > 12) {
  console.warn(`\n! ${mb(gif)} MB is heavy for a README. Prefer the mp4, or lower fps/width.`);
}
