import type { Request, Response, NextFunction } from 'express';
import { midwayAuth, midwayUserHeader } from './midway.js';
import { cognitoAuth } from './auth-cognito.js';
import { config } from '../config/aws.js';

export interface AuthUser {
  alias: string;
  email: string;
  authenticated: boolean;
}

/**
 * Authentication dispatcher.
 *
 * Selects an auth strategy based on AUTH_PROVIDER:
 *   - "midway"  — AWS internal (Midway cookie / x-midway-user header)
 *   - "cognito" — stub: verify JWT against a Cognito user pool (not shipped)
 *   - "none"    — allow all requests; attaches a synthetic user.
 *                 Disallowed in production unless ALLOW_UNAUTHENTICATED=true.
 *
 * Back-compat: MIDWAY_DISABLED=true forces "none".
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const provider = process.env.MIDWAY_DISABLED === 'true' ? 'none' : config.authProvider;

  if (provider === 'midway') {
    midwayAuth(req, res, next);
    return;
  }

  if (provider === 'cognito') {
    void cognitoAuth(req, res, next);
    return;
  }

  // provider === "none"
  const user: AuthUser = {
    alias: process.env.USER ?? 'anonymous',
    email: `${process.env.USER ?? 'anonymous'}@example.com`,
    authenticated: true,
  };
  (req as unknown as { authUser: AuthUser }).authUser = user;
  (req as unknown as { midwayUser: AuthUser }).midwayUser = user;
  next();
}

export function authUserHeader(req: Request, res: Response, next: NextFunction): void {
  return midwayUserHeader(req, res, next);
}

/**
 * Fail-closed guard: refuse to serve production traffic without auth.
 * Call once at startup.
 */
export function assertSafeAuthConfig(): void {
  const provider = process.env.MIDWAY_DISABLED === 'true' ? 'none' : config.authProvider;
  const isProd = config.nodeEnv === 'production';
  const allowUnauth = process.env.ALLOW_UNAUTHENTICATED === 'true';

  if (isProd && provider === 'none' && !allowUnauth) {
    throw new Error(
      'Refusing to start: AUTH_PROVIDER=none (or MIDWAY_DISABLED=true) in production. ' +
        'Set AUTH_PROVIDER=midway|cognito, or explicitly opt in with ALLOW_UNAUTHENTICATED=true (demo only).',
    );
  }
}
