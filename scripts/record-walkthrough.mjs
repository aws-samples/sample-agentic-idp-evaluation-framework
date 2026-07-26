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

/**
 * Run the flow once in an UNRECORDED context and return the comparison strip as a data URL.
 *
 * Returns null on any failure — a missing strip degrades the title card to text, which is
 * still far better than the blank white frame this replaced, so it must never abort the
 * recording.
 */
async function captureComparisonStrip(browserForCapture) {
  console.log('[0/4] capturing a comparison screenshot for the title card…');
  const ctx = await browserForCapture.newContext({ viewport: SIZE, deviceScaleFactor: 1 });
  const p2 = await ctx.newPage();
  try {
    await p2.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p2.waitForTimeout(2000);
    await p2.locator('input[type=file]').first().setInputFiles(DOC);
    await p2.waitForTimeout(1500);
    await p2.locator('button:has-text("Upload and Analyze")').first().click();
    await p2.waitForURL(/\/conversation/, { timeout: 60000 });
    await p2.waitForFunction(
      () => {
        const b = [...document.querySelectorAll('button')].find((x) => /skip/i.test(x.textContent || ''));
        return b && !b.disabled;
      },
      { timeout: 120000 },
    );
    await p2.locator('button:has-text("Skip")').first().click();

    // Wait for the fan-out to finish — "Preview complete" is the marker.
    const deadline = Date.now() + Number(process.env.PREVIEW_WAIT_MS || 240000);
    while (Date.now() < deadline) {
      const t = await p2.locator('body').innerText().catch(() => '');
      if (/Preview complete/i.test(t)) break;
      await p2.waitForTimeout(3000);
    }
    await p2.waitForTimeout(2500);

    /*
     * Frame the results panel: the method chips with their measured latencies.
     *
     * Do NOT climb the ancestor chain looking for something "tall enough". Measured against
     * the live DOM, the heading's parent is already a 2538px Cloudscape container spanning
     * the whole page, so a `height < 320` climb overshot on the first hop and the clip
     * captured the top of the page — the title card ended up showing the advisor screen
     * instead of the comparison.
     *
     * Anchor on the panel's own bounds instead: take the heading's position and cut a fixed
     * band downward from it. That is stable regardless of how Cloudscape nests its wrappers.
     */
    /*
     * Scroll the panel to the TOP of the viewport, not merely into view.
     * `scrollIntoViewIfNeeded` stops as soon as the element is visible, which left the
     * heading at y=1061 of a 1200px viewport — so the 430px band had only 139px of room and
     * the crop captured a sliver containing just the heading. Positioning it explicitly
     * guarantees the chips and the first comparison rows are below it.
     */
    const panel = p2.locator('text=Preview complete').first();
    await panel.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await p2.waitForTimeout(300);
    // Nudge up so the panel's own border and padding are inside the frame.
    await p2.evaluate(() => window.scrollBy(0, -40));
    await p2.waitForTimeout(900);
    const box = await p2.evaluate(() => {
      const el = [...document.querySelectorAll('*')]
        .find((x) => /^Preview complete/.test(x.textContent?.trim() ?? '') && x.children.length <= 2);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.y < 0 || r.y > window.innerHeight) return null;
      // Start a little above the heading and take the band that holds the chips + the
      // first rows of the comparison table.
      const top = Math.max(0, r.y - 28);
      return {
        x: Math.max(0, r.x - 40),
        y: top,
        width: Math.min(1460, window.innerWidth - Math.max(0, r.x - 40)),
        height: Math.min(430, window.innerHeight - top),
      };
    });
    if (!box) throw new Error('results panel not on screen after the fan-out');
    const shot = await p2.screenshot({ clip: box });
    console.log(`      captured ${Math.round(box.width)}x${Math.round(box.height)} at y=${Math.round(box.y)}`);
    return `data:image/png;base64,${shot.toString('base64')}`;
  } catch (e) {
    console.warn(`      ! could not capture (${String(e.message).slice(0, 90)}) — title card will be text only`);
    return null;
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch({ headless: true });

/*
 * ORDER IS LOAD-BEARING: the throwaway screenshot pass runs BEFORE the recorded context
 * exists.
 *
 * Playwright starts capturing the instant `newContext({recordVideo})` returns, so a first
 * attempt that captured the strip after this line put ~60 seconds of blank white frames at
 * the head of the video — the exact problem the title card was meant to solve, just longer.
 * Nothing that waits on the network may happen between the context being created and the
 * first painted frame.
 */
const previewPng = await captureComparisonStrip(browser);

const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  recordVideo: { dir: WORK, size: SIZE },
});
const page = await context.newPage();

/**
 * The opening title card — and, more importantly, the video's THUMBNAIL.
 *
 * GitHub renders the embed with `controls` but emits no `poster` attribute, and markdown
 * gives no way to supply one, so whatever is in frame 0 is the still image every visitor
 * sees before pressing play. Recording used to start at `page.goto`, so frame 0 was a
 * blank white rectangle.
 *
 * This is drawn into `about:blank` before the app loads, so it costs nothing in the app
 * and cannot be affected by load timing. It states the problem, the product and the four
 * steps, so the README's hero communicates even when nobody plays it.
 */
async function titleCard(previewPng, ms = 3200) {
  await page.evaluate(({ steps, previewPng }) => {
    const el = document.createElement('div');
    el.innerHTML = `
      <div style="font:600 22px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:3px;text-transform:uppercase;color:#5b9dff;margin-bottom:26px">
        ONE IDP Evaluation Framework
      </div>
      <div style="font:700 66px/1.12 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-1.6px;max-width:1360px">
        Which AWS method should process<br>your documents?
      </div>
      <div style="font:400 29px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;opacity:.72;margin-top:26px;max-width:1180px">
        Stop guessing. Run all 29 on your own document and compare
        real cost, speed and output.
      </div>
      <div style="display:flex;gap:14px;margin-top:40px;font:600 21px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        ${steps.map((t, i) => `
          <span style="display:flex;align-items:center;gap:14px">
            <span style="display:inline-flex;align-items:center;gap:10px;padding:14px 22px;border:1px solid rgba(255,255,255,.22);border-radius:10px;background:rgba(255,255,255,.05)">
              <span style="color:#5b9dff">${i + 1}</span><span>${t}</span>
            </span>
            ${i < steps.length - 1 ? '<span style="opacity:.3">→</span>' : ''}
          </span>`).join('')}
      </div>
      ${previewPng ? `
      <!--
        A real frame from this very recording, sitting under the title. The card alone
        said what the tool is FOR; this shows what it actually produces — 19 methods with
        measured latencies and a per-capability comparison — so the still frame is
        evidence rather than a claim. Cropped at the top so it reads as the app continuing
        below the fold instead of a floating screenshot.
      -->
      <div style="margin-top:46px;width:1500px;border-radius:12px 12px 0 0;overflow:hidden;
                  border:1px solid rgba(255,255,255,.16);border-bottom:none;
                  box-shadow:0 -8px 60px rgba(0,0,0,.5);mask-image:linear-gradient(to bottom,#000 72%,transparent 100%);
                  -webkit-mask-image:linear-gradient(to bottom,#000 72%,transparent 100%)">
        <img src="${previewPng}" style="display:block;width:100%">
      </div>` : ''}`;
    Object.assign(el.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start', textAlign: 'center',
      paddingTop: '96px',
      // A dark card, deliberately: the app itself is near-white, so this reads as a
      // title rather than as a half-loaded page.
      background: 'linear-gradient(160deg,#0b1220 0%,#111c2f 55%,#0d1524 100%)',
      color: '#fff', fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
    });
    document.documentElement.style.background = '#0b1220';
    document.body.style.margin = '0';
    document.body.appendChild(el);
  }, { steps: ['Upload', 'Analyze & Compare', 'Build Pipeline', 'Architecture & Code'], previewPng });
  await page.waitForTimeout(ms);
}

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
  /*
   * The title card is painted BEFORE the app loads, so frame 0 is never blank.
   *
   * This matters more than it sounds: GitHub renders the video with `controls` but no
   * `poster` attribute and no way to supply one from markdown, so the browser shows the
   * FIRST FRAME as the thumbnail. Recording used to begin at `page.goto`, which meant a
   * completely white frame — the README's hero was an empty rectangle until someone
   * pressed play. Painting the card into `about:blank` first makes the still frame carry
   * the pitch on its own.
   */
  await page.goto('about:blank');
  await titleCard(previewPng);

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);

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

/**
 * Mean luma of one frame, 0-255. A cheap, dependency-free frame inspector: downscale to
 * 8x8 greyscale and average the raw bytes.
 */
function meanLuma(file, atSeconds) {
  const out = execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(atSeconds), '-i', file, '-frames:v', '1',
    '-vf', 'format=gray,scale=8:8', '-f', 'rawvideo', '-',
  ], { maxBuffer: 1 << 20 });
  if (out.length === 0) return 255;
  let sum = 0;
  for (const b of out) sum += b;
  return Math.round(sum / out.length);
}

/**
 * First timestamp whose frame is not a blank white page.
 *
 * The app and the title card are both non-blank; only the pre-paint `about:blank` frames
 * are near-white at 255. Threshold 200 separates them with a wide margin (measured: blank
 * 240-253, title card 15-75, app UI 228-242 — note the app is BRIGHT too, which is why
 * this only ever runs over the first second and takes the FIRST non-blank frame rather
 * than looking for darkness).
 */
async function findFirstNonBlankFrame(file) {
  for (const t of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0]) {
    if (meanLuma(file, t) <= 200) return t;
  }
  console.warn('      ! no non-blank frame found in the first second; not trimming');
  return 0;
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
/*
 * TRIM the leading blank frames, then re-check.
 *
 * The title card is painted into `about:blank` before the app loads, but Playwright still
 * records one or two frames of the empty page before that paint lands — and GitHub uses
 * frame 0 as the thumbnail, so a single white frame is enough to make the README's hero an
 * empty rectangle. Measured: the card was fully present from t=0.2s while t=0 was white.
 *
 * Relying on the paint winning the race is not good enough (it did on one run and not the
 * next), so the blank head is cut deterministically here instead. `blackframe`-style
 * detection would not help: these frames are WHITE. So the trim point is measured directly
 * by sampling luma, and the result is asserted below — if frame 0 is still blank after the
 * trim, the script fails loudly rather than shipping a blank thumbnail.
 */
const START = await findFirstNonBlankFrame(raw);
console.log(`      trimming ${START.toFixed(2)}s of blank leader`);
ff([
  '-ss', String(START),
  '-i', raw,
  '-filter:v', `setpts=PTS/${SPEEDUP}`,
  '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  mp4,
]);

// Assert the fix held. A blank thumbnail is the whole bug; never ship it silently.
const firstLuma = meanLuma(mp4, 0);
if (firstLuma > 200) {
  throw new Error(
    `frame 0 of the encoded mp4 is still blank (mean luma ${firstLuma}). GitHub uses it as `
    + 'the thumbnail, so this would render as an empty rectangle. Raise the trim window in '
    + 'findFirstNonBlankFrame.',
  );
}
console.log(`      frame 0 mean luma ${firstLuma} (dark title card, not blank)`);

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
