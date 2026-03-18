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

// Detailed health check with environment validation (#23)
router.get('/detailed', async (_req, res) => {
  const checks: Record<string, { status: 'ok' | 'warning' | 'error'; message: string }> = {};

  // AWS Region
  checks.region = config.region
    ? { status: 'ok', message: config.region }
    : { status: 'error', message: 'AWS_REGION not set' };

  // S3 bucket
  if (config.s3Bucket) {
    checks.s3 = { status: 'ok', message: config.s3Bucket };
  } else if (process.env.USE_LOCAL_STORAGE === 'true') {
    checks.s3 = { status: 'warning', message: 'Using local storage (USE_LOCAL_STORAGE=true)' };
  } else {
    checks.s3 = { status: 'error', message: 'S3_BUCKET not set and USE_LOCAL_STORAGE not enabled' };
  }

  // Bedrock models
  checks.claudeModel = config.claudeModelId
    ? { status: 'ok', message: config.claudeModelId }
    : { status: 'error', message: 'CLAUDE_MODEL_ID not set' };

  checks.novaModel = config.novaModelId
    ? { status: 'ok', message: config.novaModelId }
    : { status: 'warning', message: 'NOVA_MODEL_ID not set (Nova methods unavailable)' };

  // BDA
  checks.bdaStandard = config.bdaProfileArn
    ? { status: 'ok', message: 'BDA_PROFILE_ARN configured' }
    : { status: 'warning', message: 'BDA_PROFILE_ARN not set (BDA Standard unavailable)' };

  checks.bdaCustom = config.bdaProjectArn
    ? { status: 'ok', message: 'BDA_PROJECT_ARN configured' }
    : { status: 'warning', message: 'BDA_PROJECT_ARN not set (BDA Custom unavailable)' };

  // Midway auth
  checks.auth = process.env.MIDWAY_DISABLED === 'true'
    ? { status: 'warning', message: 'Midway disabled (dev mode)' }
    : { status: 'ok', message: 'Midway authentication enabled' };

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
