import type { Request, Response, NextFunction } from 'express';

/**
 * CloudFront origin validation middleware.
 *
 * In production, verifies that the `X-CloudFront-Secret` header matches the
 * `CLOUDFRONT_SECRET` env var. This prevents clients from bypassing CloudFront
 * and hitting the App Runner origin directly (threat model item T2.1).
 *
 * Behaviour:
 *   - If `CLOUDFRONT_SECRET` env var is unset or empty, the check is skipped
 *     (backwards compatible for deployments that haven't configured it yet).
 *   - In development (`NODE_ENV !== 'production'`), the check is skipped.
 *   - Health-check paths are exempt so ALB/App Runner probes still work.
 */
export function cloudfrontSecretMiddleware(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.CLOUDFRONT_SECRET;

  // Skip when not configured or not in production
  if (!secret || process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  // Exempt health-check paths (App Runner / ALB probes don't carry the header)
  if (req.path === '/api/health' || req.path.startsWith('/api/health/')) {
    next();
    return;
  }

  const headerValue = req.headers['x-cloudfront-secret'] as string | undefined;
  if (headerValue === secret) {
    next();
    return;
  }

  res.status(403).json({ error: 'Forbidden' });
}
