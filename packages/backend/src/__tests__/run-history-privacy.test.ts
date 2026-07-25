import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf-8');

/**
 * Run history is a DOCUMENT DISCLOSURE risk on a shared deployment.
 *
 * With `AUTH_PROVIDER=none` every visitor authenticates as the same alias
 * (`local-user` unless DEV_USER_ALIAS is set), so `getRecentRuns(user.alias)` returns
 * ONE shared list. On the public CloudFront demo that means any visitor can list,
 * open and resume the documents another person uploaded, and one person's evaluation
 * can be contaminated with someone else's file.
 *
 * These are source-level assertions rather than HTTP tests because the property that
 * matters is structural: the refusal must be at the API, must not exempt admins, and
 * must default to ON. A request-level test could pass while the default flipped.
 */
describe('run history is refused server-side, not just hidden', () => {
  const runsRoute = read('packages/backend/src/routes/runs.ts');
  const awsConfig = read('packages/backend/src/config/aws.ts');
  const app = read('packages/frontend/src/App.tsx');

  it('guards BOTH run endpoints, not only the list', () => {
    // A known runId must not be fetchable either — otherwise the list is hidden
    // while the records stay readable to anyone who saw one.
    const guards = runsRoute.match(/runHistoryDisabled\(res\)/g) ?? [];
    expect(guards.length, 'expected the guard on both / and /:runId').toBeGreaterThanOrEqual(2);
  });

  it('guards before reading any record', () => {
    // The guard must precede the DynamoDB read, so a disabled deployment does not
    // fetch other users' documents at all.
    const listIdx = runsRoute.indexOf("router.get('/'");
    const guardIdx = runsRoute.indexOf('runHistoryDisabled(res)', listIdx);
    const readIdx = runsRoute.indexOf('getRecentRuns', listIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx, 'guard must run before getRecentRuns').toBeLessThan(readIdx);
  });

  it('does NOT exempt admins', () => {
    /*
     * Deliberate: on a demo with authentication disabled, anyone could claim an admin
     * alias, so an admin exemption would be the same hole with extra steps. The guard
     * function must not consult the admin list.
     */
    const guardFn = runsRoute.slice(
      runsRoute.indexOf('function runHistoryDisabled'),
      runsRoute.indexOf('function runHistoryDisabled') + 900,
    );
    expect(guardFn).not.toMatch(/adminUsers/);
  });

  it('defaults to DISABLED when authentication is off', () => {
    // The unsafe configuration is also the default one, so history must be opt-in.
    expect(awsConfig).toMatch(/disableRunHistory/);
    expect(awsConfig).toMatch(/AUTH_PROVIDER.*?===.*?'none'/s);
  });

  it('returns 403 with a reason rather than an empty list', () => {
    // An empty list would read as "you have no runs", which is a different and
    // misleading statement from "this deployment does not store history".
    expect(runsRoute).toMatch(/status\(403\)/);
    expect(runsRoute).toMatch(/disabled: true/);
  });

  it('the client fails CLOSED if it cannot read the flag', () => {
    // Defaulting to enabled on a failed fetch would advertise history the server may
    // refuse — for a disclosure control the safe direction is off.
    expect(app).toMatch(/useState\(true\)/);
    expect(app).toMatch(/health\/features/);
  });

  it('hides the route as well as the nav entry', () => {
    // A direct /runs URL must not render a page that only produces 403s.
    expect(app).toMatch(/!runHistoryDisabled && \(\s*<Route/s);
  });
});

/**
 * The infrastructure default has to match the code default, or a deployment gets the
 * unsafe configuration while the code claims to be safe.
 */
describe('infrastructure defaults run history off', () => {
  it('Terraform defaults disable_run_history to true', () => {
    const vars = read('infrastructure/variables.tf');
    const block = vars.slice(vars.indexOf('variable "disable_run_history"'));
    expect(block.slice(0, 1600)).toMatch(/default\s*=\s*true/);
  });

  it('Terraform passes the flag to the container', () => {
    expect(read('infrastructure/ecs.tf')).toMatch(/DISABLE_RUN_HISTORY/);
  });

  it('CDK defaults to true and requires an explicit opt-out', () => {
    expect(read('infrastructure-cdk/lib/ecs-backend.ts'))
      .toMatch(/props\.disableRunHistory \?\? true/);
    // `!== 'false'` means anything other than a deliberate "false" stays disabled.
    expect(read('infrastructure-cdk/bin/app.ts'))
      .toMatch(/tryGetContext\('disableRunHistory'\) !== 'false'/);
  });
});
