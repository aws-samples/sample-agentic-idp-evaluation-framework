import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { METHODS, CAPABILITIES, CAPABILITY_CATEGORIES, TOTAL_STEPS, METHOD_INFO } from '@idp/shared';

/**
 * The documentation users read had drifted badly, and nothing caught it.
 *
 * Found by audit: the served docs described an **App Runner backend** (it has been ECS
 * Fargate behind an ALB for some time), claimed **15 methods** (29), called the workflow
 * **5-step** (4 steps), priced **Nova 2 Pro** — a model removed because its id was not
 * resolvable in any region — quoted Nova at 2x its real price, hardcoded a dead
 * CloudFront distribution id, and linked to `/workflow` when the SPA serves
 * `/docs/workflow`, so every cross-link 404'd.
 *
 * Prose cannot be derived from the catalog, so it needs a test instead. These assertions
 * are deliberately about FACTS that have a machine-checkable counterpart — counts,
 * removed models, service names, link shapes — not about wording.
 *
 * Note which directory is checked. `packages/docs/**` is a dead second copy that nothing
 * builds or serves (see its README); `public/docs-content/**` is what DocsPage fetches at
 * runtime. Auditing the wrong tree is how the drift survived a previous review.
 */
const SERVED = join(
  import.meta.dirname, '..', '..', '..', 'frontend', 'public', 'docs-content',
);

const files = readdirSync(SERVED).filter((f) => f.endsWith('.md'));
const read = (f: string) => readFileSync(join(SERVED, f), 'utf-8');
const all = files.map((f) => [f, read(f)] as const);

describe('the served docs describe the system that actually exists', () => {
  it('finds the served docs (guards against checking an empty directory)', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it('does not describe an App Runner backend', () => {
    // The migration to ECS Fargate + ALB happened; the docs never followed.
    const offenders = all.filter(([, body]) => /App\s*Runner/i.test(body)).map(([f]) => f);
    expect(offenders, `still mention App Runner: ${offenders.join(', ')}`).toEqual([]);
  });

  it('does not reference models that were removed from the catalog', () => {
    /*
     * Nova 2 Pro's preview id resolved in no region, so every run using it failed and it
     * was deleted from METHOD_INFO. Documenting a method a user cannot select is worse
     * than omitting it: they go looking for it.
     */
    const REMOVED = ['Nova 2 Pro', 'nova-2-pro', 'nova-pro', 'Nova Pro'];
    const offenders: string[] = [];
    for (const [f, body] of all) {
      for (const name of REMOVED) {
        // A line explaining that it WAS removed is fine; advertising it is not.
        for (const line of body.split('\n')) {
          if (!line.includes(name)) continue;
          if (/\bremoved\b|\bwas not resolvable\b|\bno longer\b/i.test(line)) continue;
          offenders.push(`${f}: ${line.trim().slice(0, 70)}`);
        }
      }
    }
    expect(offenders, `reference a removed model: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('states method and capability counts that match the catalog', () => {
    const offenders: string[] = [];
    for (const [f, body] of all) {
      for (const m of body.matchAll(/(\d+)\s+(?:processing\s+)?methods?\b/gi)) {
        if (Number(m[1]) !== METHODS.length) offenders.push(`${f}: "${m[0]}" (actual ${METHODS.length})`);
      }
      for (const m of body.matchAll(/(\d+)\s+capabilit/gi)) {
        if (Number(m[1]) !== CAPABILITIES.length) offenders.push(`${f}: "${m[0]}" (actual ${CAPABILITIES.length})`);
      }
      for (const m of body.matchAll(/(\d+)\s+categor/gi)) {
        if (Number(m[1]) !== CAPABILITY_CATEGORIES.length) {
          offenders.push(`${f}: "${m[0]}" (actual ${CAPABILITY_CATEGORIES.length})`);
        }
      }
      for (const m of body.matchAll(/(\d+)[-\s]step\s+workflow/gi)) {
        if (Number(m[1]) !== TOTAL_STEPS) offenders.push(`${f}: "${m[0]}" (actual ${TOTAL_STEPS})`);
      }
    }
    expect(offenders, `stale counts: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('quotes token prices that match the catalog', () => {
    /*
     * Cost comparison is the entire point of this tool, so a wrong price in the docs
     * undermines the product's central claim. Nova was documented at $0.30/$2.50 — 2x its
     * real $0.15/$1.25 — which is exactly the class of error `sync-model-catalog.mjs`
     * found in METHOD_INFO itself.
     */
    const pricing = read('pricing.md');
    const rows = [...pricing.matchAll(/^\|\s*([^|]+?)\s*\|\s*\$?([\d.]+)\s*\|\s*\$?([\d.]+|—)\s*\|$/gm)];
    expect(rows.length, 'no price rows parsed from pricing.md').toBeGreaterThan(3);

    const byName = new Map<string, { input: number; output: number }>();
    for (const id of METHODS) {
      const info = METHOD_INFO[id];
      byName.set(info.shortName.toLowerCase(), {
        input: info.tokenPricing.inputPer1MTokens,
        output: info.tokenPricing.outputPer1MTokens,
      });
    }

    const offenders: string[] = [];
    for (const [, label, inStr, outStr] of rows) {
      // Only check rows that name a single model we can resolve unambiguously.
      const key = label.trim().toLowerCase().replace(/^claude /, '').replace(/^amazon /, '');
      const hit = byName.get(key);
      if (!hit) continue;
      if (Number(inStr) !== hit.input) offenders.push(`${label}: doc $${inStr} in, catalog $${hit.input}`);
      if (outStr !== '—' && Number(outStr) !== hit.output) {
        offenders.push(`${label}: doc $${outStr} out, catalog $${hit.output}`);
      }
    }
    expect(offenders, `price mismatches: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('links to doc pages at the route the SPA actually serves', () => {
    /*
     * DocsPage renders at `/docs/<slug>` and intercepts clicks on hrefs starting
     * `/docs/`. A bare `](/workflow)` fell through to the SPA router, matched nothing,
     * and dumped the reader on the landing page — losing their place in the docs.
     */
    const SLUGS = new Set(files.map((f) => f.replace(/\.md$/, '')));
    const offenders: string[] = [];
    for (const [f, body] of all) {
      for (const m of body.matchAll(/\]\(\/([a-z-]+)\)/g)) {
        if (SLUGS.has(m[1])) offenders.push(`${f}: ](/${m[1]}) should be ](/docs/${m[1]})`);
      }
    }
    expect(offenders, `links bypass /docs: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('hardcodes no account id, distribution id, bucket name or internal hostname', () => {
    /*
     * This is a PUBLIC repository. A stale CloudFront distribution id and an internal
     * `*.people.aws.dev` hostname carrying a personal alias were both committed here.
     * Neither helps a reader — the ids belong to a deployment they do not own.
     */
    const LEAKS = [
      /\b\d{12}\b/,                       // AWS account id
      /\bE[A-Z0-9]{12,13}\b/,             // CloudFront distribution id
      /\b[a-z0-9]{13,14}\.cloudfront\.net\b/,
      /people\.aws\.dev/,
      /\.a2z\.com/,
    ];
    const offenders: string[] = [];
    for (const [f, body] of all) {
      for (const pattern of LEAKS) {
        const hit = body.match(pattern);
        if (hit) offenders.push(`${f}: ${hit[0]}`);
      }
    }
    expect(offenders, `hardcoded deployment identifiers: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('names infrastructure files that actually exist', () => {
    /*
     * The docs listed `lib/app-runner.ts` as the backend stack. That file was deleted in
     * the move to ECS Fargate — the real one is `lib/ecs-backend.ts` — so a reader
     * following the docs looks for a file that is not there. A prose sweep for
     * "App Runner" missed it because the mention was inside a code-formatted path.
     */
    const CDK_LIB = join(import.meta.dirname, '..', '..', '..', '..', 'infrastructure-cdk', 'lib');
    const real = new Set(readdirSync(CDK_LIB));
    /*
     * Only THIS repo's stack files. The docs also name paths inside the project the tool
     * GENERATES (`lib/idp-stack.ts`), which by definition do not exist here — checking
     * those would be a false positive, so they are listed explicitly rather than guessed.
     */
    const GENERATED_PROJECT_PATHS = new Set(['idp-stack.ts']);
    const offenders: string[] = [];
    for (const [f, body] of all) {
      for (const m of body.matchAll(/`lib\/([\w-]+\.ts)`/g)) {
        if (GENERATED_PROJECT_PATHS.has(m[1])) continue;
        if (!real.has(m[1])) offenders.push(`${f}: lib/${m[1]} does not exist`);
      }
    }
    expect(offenders, `docs name non-existent files: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('marks the unbuilt docs package so nobody edits the wrong copy', () => {
    // Two prose trees is the root cause of every drift above. The dead one must say so.
    const readme = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'docs', 'README.md'),
      'utf-8',
    );
    expect(readme).toMatch(/not built, not deployed/i);
    expect(readme).toContain('packages/frontend/public/docs-content/');
  });
});
