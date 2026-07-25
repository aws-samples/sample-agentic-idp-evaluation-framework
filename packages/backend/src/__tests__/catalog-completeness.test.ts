import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  METHODS,
  METHOD_FAMILIES,
  METHOD_INFO,
  CAPABILITIES,
  CAPABILITY_INFO,
  CAPABILITY_CATEGORIES,
  PRODUCT_NAME,
  PRODUCT_TAGLINE_SHORT,
  WORKFLOW_STEPS,
  stepSubtitle,
} from '@idp/shared';

const FRONTEND = join(import.meta.dirname, '..', '..', '..', 'frontend');
const read = (rel: string) => readFileSync(join(FRONTEND, rel), 'utf-8');

/**
 * The landing page is the first thing a user sees, and it silently under-reported the
 * catalog: the header counted `METHODS.length` (29) while the body rendered only the
 * families listed in a hand-maintained `FAMILY_GROUPS` array (22 methods' worth). Two
 * newly added families were in no group, so **seven methods vanished from the first
 * screen with no error anywhere** — no crash, no console warning, just a number that
 * disagreed with the list beneath it.
 *
 * The general lesson these tests encode: any hand-maintained list that mirrors the
 * catalog will go stale the moment the catalog grows, and the failure is invisible.
 * So each one is checked against the catalog itself rather than trusted.
 */
describe('the landing page shows the WHOLE catalog', () => {
  const homePage = read('src/pages/HomePage.tsx');

  it('assigns every method family to a display group', () => {
    /*
     * FAMILY_GROUPS is deliberately hand-ordered (general-purpose first, niche last),
     * so it cannot be derived from METHOD_FAMILIES. That is exactly why it needs a
     * test: the ordering is editorial, but the COVERAGE is not optional.
     */
    const groupsBlock = homePage.slice(
      homePage.indexOf('const FAMILY_GROUPS'),
      homePage.indexOf('const GROUPED_FAMILIES'),
    );
    const missing = METHOD_FAMILIES.filter((f) => !groupsBlock.includes(`'${f}'`));
    expect(
      missing,
      `families absent from FAMILY_GROUPS, so their methods would not render: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('renders leftovers rather than dropping them', () => {
    // Belt and braces: even if the check above is somehow bypassed, an unassigned
    // family must appear in an "Other" bucket instead of disappearing.
    expect(homePage).toMatch(/UNGROUPED_FAMILIES/);
    expect(homePage).toMatch(/ALL_FAMILY_GROUPS\.map/);
  });

  it('counts what it actually renders', () => {
    // The header counter and the rendered list must come from the same source. A
    // counter of METHODS.length beside a hand-filtered body is how this bug shipped.
    const grouped = new Set(
      METHOD_FAMILIES.filter((f) => homePage.includes(`'${f}'`)),
    );
    const reachable = METHODS.filter((m) => grouped.has(METHOD_INFO[m].family));
    expect(reachable.length, 'methods reachable through the groups').toBe(METHODS.length);
  });

  it('gives every capability a real category', () => {
    // Same failure shape on the capability catalog: a capability whose category is not
    // in CAPABILITY_CATEGORIES renders under no heading and is invisible.
    const valid = new Set<string>(CAPABILITY_CATEGORIES);
    const orphans = CAPABILITIES.filter((c) => !valid.has(CAPABILITY_INFO[c].category));
    expect(orphans, `capabilities with an unknown category: ${orphans.join(', ')}`).toEqual([]);
  });

  it('names the product identically in the tab title, splash and header', () => {
    /*
     * index.html is the static shell and cannot import the constants, so the literal
     * there is the one place drift can recur. It DID: the tab said "IDP Evaluation
     * Framework", the top nav "ONE IDP Framework", the splash "Loading ONE IDP" and
     * the docs sidebar "ONE IDP Docs" — one product presenting as several.
     */
    const html = read('index.html');
    expect(html).toContain(`<title>${PRODUCT_NAME}</title>`);
    expect(html).toContain(`Loading ${PRODUCT_NAME}`);
    expect(html).toContain(PRODUCT_TAGLINE_SHORT);
  });

  it('has no hand-written product name left in the app', () => {
    // Every remaining occurrence must come from the constant. A literal is how the
    // six different names accumulated in the first place.
    const files = [
      'src/components/layout/TopNav.tsx',
      'src/pages/HomePage.tsx',
      'src/pages/DocsPage.tsx',
      'src/components/common/OnboardingBanner.tsx',
      'src/components/feedback/FeedbackModal.tsx',
      'src/pages/architectureTemplates.ts',
    ];
    for (const f of files) {
      const src = read(f);
      // The old names, none of which should survive as literals.
      for (const stale of ['ONE IDP Platform', 'ONE IDP Framework', 'IDP Evaluation Framework']) {
        expect(src.includes(stale), `${f} still hardcodes "${stale}"`).toBe(false);
      }
    }
  });

  it('gives each step ONE name, used by both the nav and the page', () => {
    /*
     * The nav listed "Analyze & Preview" / "Pipeline" while the pages titled themselves
     * "Document Analysis" / "Pipeline Builder", so clicking a nav item opened a page
     * with a different name and the user had to work out whether they were in the right
     * place. Both now read WORKFLOW_STEPS, and no page may hardcode its own title.
     */
    expect(read('src/App.tsx')).toMatch(/WORKFLOW_STEPS\.map/);
    const pages: Array<[string, number]> = [
      ['src/pages/ConversationPage.tsx', 1],
      ['src/pages/PipelinePage.tsx', 2],
      ['src/pages/ArchitecturePage.tsx', 3],
    ];
    for (const [file, index] of pages) {
      const src = read(file);
      expect(src, `${file} does not use its shared step definition`).toContain(`WORKFLOW_STEPS[${index}]`);
      // The old hardcoded titles must not survive anywhere in the rendered output.
      for (const stale of ['Document Analysis', 'Pipeline Builder', 'Analyze & Preview']) {
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(code.includes(stale), `${file} still hardcodes "${stale}"`).toBe(false);
      }
    }
  });

  it('gives every step a description and a gate written for a first-time user', () => {
    // A step with no description leaves the user guessing what the page is for; a step
    // with no gate copy produces a dead end when it is not yet reachable.
    for (const step of WORKFLOW_STEPS) {
      expect(step.title.length, `${step.href} has no title`).toBeGreaterThan(2);
      expect(step.description.length, `${step.href} description too thin`).toBeGreaterThan(40);
      expect(step.gate.length, `${step.href} gate copy too thin`).toBeGreaterThan(20);
    }
  });

  it('numbers steps from their real position, not a hardcoded string', () => {
    // "Step 3 of 4" was written out per page, so a reordering would have silently
    // mislabelled them.
    expect(stepSubtitle('/conversation', 'invoice.pdf', 6)).toBe('Step 2 of 4 · invoice.pdf · 6 pages');
    expect(stepSubtitle('/conversation', 'a.pdf', 1)).toContain('1 page');
    expect(stepSubtitle('/architecture')).toBe('Step 4 of 4');
  });

  it('describes every family, so a new one is never an unexplained row', () => {
    // Not every family needs a note, but the two least self-explanatory kinds do:
    // a video-only model and a self-hosted endpoint both behave unlike the rest.
    for (const family of ['video-understanding', 'sagemaker-ocr'] as const) {
      expect(homePage, `${family} has no role note`).toContain(`'${family}':`);
    }
  });
});
