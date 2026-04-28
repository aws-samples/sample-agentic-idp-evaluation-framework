import type { Request, Response, NextFunction } from 'express';
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
 *   - "cognito" — verify JWT against a Cognito user pool
 *   - "none"    — allow all requests; attaches a synthetic user.
 *                 Disallowed in production unless ALLOW_UNAUTHENTICATED=true.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const provider = config.authProvider;

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
  next();
}

export function authUserHeader(req: Request, res: Response, next: NextFunction): void {
  const user = (req as unknown as { authUser: AuthUser | undefined }).authUser;
  if (user) {
    res.setHeader('X-IDP-User', user.alias);
    res.setHeader('X-IDP-Email', user.email);
  }
  next();
}

/**
 * Fail-closed guard: refuse to serve production traffic without auth.
 * Call once at startup.
 */
export function assertSafeAuthConfig(): void {
  const provider = config.authProvider;
  const isProd = config.nodeEnv === 'production';
  const allowUnauth = process.env.ALLOW_UNAUTHENTICATED === 'true';

  if (isProd && provider === 'none' && !allowUnauth) {
    throw new Error(
      'Refusing to start: AUTH_PROVIDER=none in production. ' +
        'Set AUTH_PROVIDER=cognito, or explicitly opt in with ALLOW_UNAUTHENTICATED=true (demo only).',
    );
  }
}
