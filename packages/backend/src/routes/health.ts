import { Router } from 'express';
import { config } from '../config/aws.js';

const router = Router();

// Basic health check
router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});

/*
 * Public feature flags the client needs BEFORE it renders anything.
 *
 * Lives under /api/health because that router is mounted ahead of the auth
 * middleware — the client must be able to learn that run history is off without
 * being authenticated, since on this deployment nobody is.
 *
 * Contains no secrets: one boolean about whether stored history is served.
 */
router.get('/features', (_req, res) => {
  res.json({
    // True on shared deployments, where one alias serves every visitor and stored
    // runs would leak documents between strangers. The API refuses the run
    // endpoints in that state; this only lets the UI stop advertising them.
    runHistoryDisabled: config.disableRunHistory,
  });
});

/*
 * Detailed health check.
 *
 * This route is mounted BEFORE the auth middleware (so a load balancer can reach it),
 * which means an anonymous visitor on the public demo could read it. It used to
 * report the actual values: the S3 bucket name, the region, the exact model ids and
 * that authentication was disabled — a free reconnaissance summary of the deployment
 * naming the bucket that holds uploaded documents.
 *
 * It now reports whether each thing is CONFIGURED, not what it is set to. That keeps
 * every diagnostic use (an operator wants to know which check is failing, not to be
 * told the bucket name they already own) while giving an unauthenticated caller
 * nothing to act on. Values are still visible to an authenticated admin via
 * /api/admin.
 */
router.get('/detailed', async (_req, res) => {
  const checks: Record<string, { status: 'ok' | 'warning' | 'error'; message: string }> = {};

  // Region: presence only. The region is inferable from the endpoint anyway, but
  // there is no reason to confirm it for free.
  checks.region = config.region
    ? { status: 'ok', message: 'Region configured' }
    : { status: 'error', message: 'AWS_REGION not set' };

  // S3 bucket: never echo the NAME — it holds uploaded documents.
  if (config.s3Bucket) {
    checks.s3 = { status: 'ok', message: 'Upload bucket configured' };
  } else if (process.env.USE_LOCAL_STORAGE === 'true') {
    checks.s3 = { status: 'warning', message: 'Using local storage (USE_LOCAL_STORAGE=true)' };
  } else {
    checks.s3 = { status: 'error', message: 'S3_BUCKET not set and USE_LOCAL_STORAGE not enabled' };
  }

  // Bedrock models: configured-or-not. Which model is in use is already public via
  // /api/methods (it is part of the comparison), so this adds nothing but noise.
  checks.claudeModel = config.claudeModelId
    ? { status: 'ok', message: 'Claude model configured' }
    : { status: 'error', message: 'CLAUDE_MODEL_ID not set' };

  checks.novaModel = config.novaModelId
    ? { status: 'ok', message: 'Nova model configured' }
    : { status: 'warning', message: 'NOVA_MODEL_ID not set (Nova methods unavailable)' };

  // BDA
  checks.bdaStandard = config.bdaProfileArn
    ? { status: 'ok', message: 'BDA_PROFILE_ARN configured' }
    : { status: 'warning', message: 'BDA_PROFILE_ARN not set (BDA Standard unavailable)' };

  checks.bdaCustom = config.bdaProjectArn
    ? { status: 'ok', message: 'BDA_PROJECT_ARN configured' }
    : { status: 'warning', message: 'BDA_PROJECT_ARN not set (BDA Custom unavailable)' };

  /*
   * Auth: report only that a provider is or is not configured.
   *
   * "Auth disabled (AUTH_PROVIDER=none)" told an anonymous caller, in plain language,
   * that nothing is checking credentials. That is the single most useful sentence to
   * hand an attacker probing a public URL.
   */
  checks.auth = config.authProvider === 'none'
    ? { status: 'warning', message: 'No authentication provider configured' }
    : { status: 'ok', message: 'Authentication provider configured' };

  // Count status
  const errorCount = Object.values(checks).filter((c) => c.status === 'error').length;
  const warningCount = Object.values(checks).filter((c) => c.status === 'warning').length;

  const overallStatus = errorCount > 0 ? 'degraded' : warningCount > 0 ? 'healthy_with_warnings' : 'healthy';

  res.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    checks,
    summary: {
      total: Object.keys(checks).length,
      ok: Object.values(checks).filter((c) => c.status === 'ok').length,
      warnings: warningCount,
      errors: errorCount,
    },
  });
});

export default router;
