import type { Request, Response, NextFunction } from 'express';
import { cognitoAuth } from './auth-cognito.js';
import { config } from '../config/aws.js';

export interface AuthUser {
  alias: string;
  email: string;
  authenticated: boolean;
}

// Computed path so TypeScript does not resolve the optional midway module at
// compile time.  At runtime the string is just './midway.js'.
const MIDWAY_MODULE = './midway' + '.js';

interface MidwayModule {
  midwayAuth: (req: Request, res: Response, next: NextFunction) => void;
  midwayUserHeader: (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Authentication dispatcher.
 *
 * Selects an auth strategy based on AUTH_PROVIDER:
 *   - "midway"  — AWS internal (Midway cookie / x-midway-user header).
 *                 Loaded via dynamic import; not included in public distribution.
 *   - "cognito" — verify JWT against a Cognito user pool
 *   - "none"    — allow all requests; attaches a synthetic user.
 *                 Disallowed in production unless ALLOW_UNAUTHENTICATED=true.
 *
 * Back-compat: MIDWAY_DISABLED=true forces "none".
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const provider = process.env.MIDWAY_DISABLED === 'true' ? 'none' : config.authProvider;

  if (provider === 'midway') {
    void (async () => {
      try {
        const mod = await import(MIDWAY_MODULE) as MidwayModule;
        mod.midwayAuth(req, res, next);
      } catch {
        res.status(500).json({
          error: 'AUTH_PROVIDER=midway requires the midway auth module which is not included in the public distribution. ' +
            'Use AUTH_PROVIDER=cognito or AUTH_PROVIDER=none instead.',
        });
      }
    })();
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
  next();
}

export function authUserHeader(req: Request, res: Response, next: NextFunction): void {
  if (config.authProvider === 'midway') {
    void (async () => {
      try {
        const mod = await import(MIDWAY_MODULE) as MidwayModule;
        mod.midwayUserHeader(req, res, next);
      } catch {
        // Midway module not available — fall through to default header logic
        const user = (req as unknown as { authUser: AuthUser | undefined }).authUser;
        if (user) {
          res.setHeader('X-IDP-User', user.alias);
          res.setHeader('X-IDP-Email', user.email);
        }
        next();
      }
    })();
    return;
  }

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
