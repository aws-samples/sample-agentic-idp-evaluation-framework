import type { RequestHandler } from 'express';

interface RateLimitStore {
  [ip: string]: { count: number; resetAt: number };
}

/**
 * Simple in-memory rate limiter. No external dependencies.
 * For production, use redis-backed solution.
 */
export function rateLimit(maxRequests: number, windowMs: number): RequestHandler {
  const store: RateLimitStore = {};

  // Cleanup expired entries every minute
  setInterval(() => {
    const now = Date.now();
    for (const key of Object.keys(store)) {
      if (store[key].resetAt < now) delete store[key];
    }
  }, 60_000).unref();

  return (req, res, next) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();

    if (!store[ip] || store[ip].resetAt < now) {
      store[ip] = { count: 1, resetAt: now + windowMs };
    } else {
      store[ip].count++;
    }

    const remaining = Math.max(0, maxRequests - store[ip].count);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(store[ip].resetAt / 1000));

    if (store[ip].count > maxRequests) {
      const retryAfter = Math.ceil((store[ip].resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        error: 'Too many requests',
        retryAfter,
      });
      return;
    }

    next();
  };
}

// Pre-configured limiters
export const processRateLimit = rateLimit(10, 60_000);   // 10 req/min for heavy endpoints
export const apiRateLimit = rateLimit(60, 60_000);        // 60 req/min for general API
