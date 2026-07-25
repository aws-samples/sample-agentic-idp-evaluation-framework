import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf-8');

/**
 * `/api/health` is mounted BEFORE the auth middleware so a load balancer can reach it,
 * which on the public demo means anyone can. `/detailed` was echoing the actual
 * configuration back: the S3 bucket name that holds uploaded documents, the region,
 * the exact model ids, and — in plain language — "Auth disabled
 * (AUTH_PROVIDER=none)". That is a free reconnaissance summary, and the last line is
 * the single most useful sentence to hand someone probing a public URL.
 *
 * The endpoint still says WHICH check fails, which is its whole diagnostic purpose;
 * it no longer says what anything is set to.
 */
describe('unauthenticated endpoints do not leak configuration', () => {
  const health = read('routes/health.ts');
  /*
   * Comments are stripped before matching: the code comments legitimately QUOTE the old
   * leaky strings to explain why they were removed, and an assertion that cannot tell
   * a comment from a response body would forbid documenting the fix.
   */
  const healthCode = health
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('never echoes a config VALUE in the detailed health response', () => {
    /*
     * Each of these interpolated or returned a real value. Asserted at source level
     * because the property is "this value is never in the response body", which a
     * single request against one deployment cannot prove.
     */
    const leaks: Array<[string, string]> = [
      ['message: config.s3Bucket', 'S3 bucket name'],
      ['message: config.region', 'AWS region'],
      ['message: config.claudeModelId', 'Claude model id'],
      ['message: config.novaModelId', 'Nova model id'],
      ['Auth provider: ${config.authProvider}', 'auth provider name'],
      ['AUTH_PROVIDER=none', 'the fact that auth is off'],
    ];
    for (const [snippet, what] of leaks) {
      expect(healthCode.includes(snippet), `/detailed still leaks the ${what}`).toBe(false);
    }
  });

  it('still reports per-check status, so it remains useful to an operator', () => {
    // The fix must not gut the endpoint: an operator needs to know which check failed.
    for (const key of ['checks.region', 'checks.s3', 'checks.auth', 'checks.bdaStandard']) {
      expect(health, `${key} check was removed rather than redacted`).toContain(key);
    }
    expect(health).toMatch(/status: 'error'/);
    expect(health).toMatch(/warningCount|errorCount/);
  });

  it('the public feature flags expose exactly one boolean', () => {
    // /features is also pre-auth. It must stay a single flag, not grow into a config dump.
    const features = health.slice(health.indexOf("router.get('/features'"), health.indexOf("router.get('/detailed'"));
    expect(features).toContain('runHistoryDisabled');
    for (const forbidden of ['s3Bucket', 'bdaProfileArn', 'bedrockGuardrailId', 'activityTable', 'adminUsers']) {
      expect(features.includes(forbidden), `/features leaks ${forbidden}`).toBe(false);
    }
  });
});
