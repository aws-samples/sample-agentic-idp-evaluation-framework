/**
 * Record the four-step walkthrough as an animation for the README.
 *
 *   BASE=https://… node scripts/record-walkthrough.mjs [document.pdf]
 *
 * Produces two assets by driving the REAL deployed app in Chromium. Nothing is mocked or
 * staged: if a step is broken, the recording shows it broken. That is the point — a README
 * animation that cannot drift from the product.
 *
 *   walkthrough.mp4   1920x1200 H.264 — THIS is what the README shows.
 *   walkthrough.webp  Animated WebP fallback, for somewhere that cannot play video.
 *
 * Both are gitignored build artifacts. The README embeds the mp4 from a GitHub
 * user-attachments URL, because a committed `<video src="docs/images/...">` does NOT render
 * on github.com — only assets uploaded through GitHub's own UI get a player. So committing
 * either file would put ~27 MB into every clone while being referenced by nothing.
 *
 * TO PUBLISH a new recording:
 *   1. run this script
 *   2. drag docs/images/walkthrough.mp4 into any issue or PR comment on github.com
 *   3. paste the URL it returns into README.md, ALONE on its own line
 * The URL must not be wrapped in <p>, <a> or markdown link syntax, or GitHub renders
 * nothing at all.
 *
 * Between steps it overlays a "Step N of 4" caption so a reader can follow along without
 * narration, and it holds on each finished screen long enough to read.
 *
 * Requires ffmpeg and img2webp (`brew install ffmpeg webp`).
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
 * 1920x1200 — 2.25x the pixels of the old 1280x800 capture.
 *
 * That old size was the root cause of the poor quality: it was recorded at 1280 wide and
 * then DOWNSCALED to 1000 for the mp4 and 760 for the GIF, so every glyph was resampled
 * twice. Measured with a probe over four configurations: Playwright's recorder honours a
 * larger viewport exactly (1920x1200 in -> 1920x1200 out), while
 * `--force-device-scale-factor=2` does NOT — the video still came out 1280x800, so a
 * higher DPR buys nothing here. Capturing at the delivery resolution and never
 * downscaling is what makes the text sharp.
 */
const SIZE = { width: 1920, height: 1200 };

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
      // Sized relative to the viewport: these were tuned for a 1280-wide frame and looked
      // small once capture moved to 1920.
      el.innerHTML = `<div style="font:700 44px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-0.5px">${text}</div>`
        + (sub ? `<div style="font:400 24px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;opacity:.85;margin-top:12px">${sub}</div>` : '');
      Object.assign(el.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '0 140px',
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
const webp = join(OUT_DIR, 'walkthrough.webp');
const run = (bin, args) => execFileSync(bin, args, { stdio: 'inherit' });
const ff = (args) => run(FFMPEG, ['-y', '-loglevel', 'error', ...args]);

/*
 * Speed up 1.6x. The honest wall-clock includes real model latency — which is the point of
 * the tool, but not watchable in a README.
 */
const SPEEDUP = 1.6;

console.log('\nencoding mp4 (full capture resolution, no downscale)…');
/*
 * No scale filter at all: the capture is already the delivery size, so any resize would
 * resample text that is currently pixel-exact. crf 20 rather than 26 because a UI
 * recording is mostly flat colour with hard type edges — the extra bitrate goes almost
 * entirely into keeping those edges clean, and H.264 compresses the flat regions to
 * nearly nothing regardless.
 *
 * This file is for uploading through GitHub's UI (drag it into a comment to get a URL).
 * A committed <video src="docs/images/...mp4"> does NOT render on github.com, so the mp4
 * cannot be referenced from the repo — hence the WebP below for the inline case.
 */
ff([
  '-i', raw,
  '-filter:v', `setpts=PTS/${SPEEDUP}`,
  '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  mp4,
]);

console.log('encoding animated webp…');
/*
 * Animated WebP replaces the GIF, and the numbers are the whole argument: the GIF was
 * 9.4 MB at 760px/8fps with a 96-colour palette, and it looked like it. WebP carries
 * 24-bit colour with real interframe compression, so the same clip fits in a fraction of
 * that at a much larger size — no palette banding on the Cloudscape greys, no dithering
 * noise on flat fills.
 *
 * ffmpeg here has no libwebp (checked: not in the build flags), so frames go out as PNG
 * and `img2webp` assembles them. That is also the better tool for this: it takes
 * per-frame timing and a lossy quality knob, which the ffmpeg webp muxer does not expose
 * as usefully.
 *
 * 12 fps: enough for the smooth scrolls to read as motion, and every frame skipped is a
 * frame not paid for. 1440 wide keeps type crisp at README width while staying well
 * under the size where GitHub starts to hesitate.
 */
const FPS = 12;
const frames = join(WORK, 'frames');
mkdirSync(frames, { recursive: true });
ff([
  '-i', mp4,
  '-vf', `fps=${FPS},scale=1440:-2:flags=lanczos`,
  join(frames, 'f-%05d.png'),
]);

const frameFiles = readdirSync(frames).filter((f) => f.endsWith('.png')).sort();
if (frameFiles.length === 0) throw new Error('no frames extracted for the webp');
/*
 * -lossy -q 72 -m 6: quality/effort tuned on this content. `-m 6` is the slowest, densest
 * search — worth it for an asset encoded once and served forever.
 * -d is the per-frame duration in ms, and -loop 0 loops forever like a GIF.
 */
run('img2webp', [
  '-loop', '0',
  '-lossy', '-q', '72', '-m', '6',
  '-d', String(Math.round(1000 / FPS)),
  ...frameFiles.map((f) => join(frames, f)),
  '-o', webp,
]);

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);
const dim = (p) => execFileSync('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', p,
]).toString().trim();

console.log(`\nmp4:  ${mp4}`);
console.log(`      ${dim(mp4)}  ${mb(mp4)} MB`);
console.log(`webp: ${webp}`);
console.log(`      ${frameFiles.length} frames @ ${FPS}fps  ${mb(webp)} MB  (fallback only)`);
console.log(`\nsource webm kept at ${raw} (${mb(raw)} MB)`);

console.log(`
Next step — both files are gitignored, so publishing is manual by design:

  1. open any issue or PR comment on github.com
  2. drag in  ${mp4}
  3. copy the https://github.com/user-attachments/assets/... URL it returns
  4. put that URL in README.md ALONE on its own line

A committed <video src="docs/images/..."> does not render on github.com, and wrapping the
URL in <p>, <a> or [](...) makes GitHub render nothing — the bare line is the whole trick.`);
