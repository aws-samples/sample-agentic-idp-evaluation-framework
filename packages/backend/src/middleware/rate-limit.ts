import type { RequestHandler } from 'express';

interface RateLimitStore {
  [key: string]: { count: number; resetAt: number };
}

/**
 * Simple in-memory rate limiter. No external dependencies.
 * For production use a Redis/Valkey-backed solution or the edge WAF.
 *
 * Keying: when the request is authenticated (authMiddleware populated
 * `authUser`/`midwayUser`), we key by the user alias so a whole team behind
 * one corporate/NAT/CloudFront egress IP doesn't share a single bucket.
 * Fall back to the forwarded IP when no user is present.
 */
export function rateLimit(maxRequests: number, windowMs: number): RequestHandler {
  const store: RateLimitStore = {};

  setInterval(() => {
    const now = Date.now();
    for (const key of Object.keys(store)) {
      if (store[key].resetAt < now) delete store[key];
    }
  }, 60_000).unref();

  return (req, res, next) => {
    const user = (req as any).authUser ?? (req as any).midwayUser;
    const alias: string | undefined = user?.alias;
    const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const ip = forwarded ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = alias ? `u:${alias}` : `ip:${ip}`;
    const now = Date.now();

    if (!store[key] || store[key].resetAt < now) {
      store[key] = { count: 1, resetAt: now + windowMs };
    } else {
      store[key].count++;
    }

    const remaining = Math.max(0, maxRequests - store[key].count);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(store[key].resetAt / 1000));

    if (store[key].count > maxRequests) {
      const retryAfter = Math.ceil((store[key].resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({ error: 'Too many requests', retryAfter });
      return;
    }

    next();
  };
}

// Pre-configured limiters — generous defaults for interactive usage.
// Override via RATE_LIMIT_PROCESS_PER_MIN / RATE_LIMIT_API_PER_MIN env vars.
const PROCESS_LIMIT = parseInt(process.env.RATE_LIMIT_PROCESS_PER_MIN ?? '30', 10);
const API_LIMIT = parseInt(process.env.RATE_LIMIT_API_PER_MIN ?? '300', 10);
export const processRateLimit = rateLimit(PROCESS_LIMIT, 60_000);
export const apiRateLimit = rateLimit(API_LIMIT, 60_000);
