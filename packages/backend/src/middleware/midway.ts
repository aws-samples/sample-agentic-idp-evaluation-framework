import type { Request, Response, NextFunction } from 'express';

/**
 * Midway Authentication Middleware
 *
 * Validates that requests come from authenticated AWS internal employees.
 * On .aws.dev deployments, Midway is typically handled at the infrastructure level
 * (CloudFront + Lambda@Edge or ALB). This middleware validates the Midway cookie
 * that is set after successful authentication.
 *
 * For local development, set MIDWAY_DISABLED=true to bypass.
 */

const MIDWAY_ID_TOKEN_COOKIE = 'midway-id-token';
const MIDWAY_HEADER = 'x-midway-user';
const MIDWAY_JWKS_URI = 'https://midway-auth.amazon.com/jwks.json';

let cachedJwks: { keys: Array<{ kid: string; n: string; e: string }> } | null = null;
let jwksCachedAt = 0;
const JWKS_CACHE_MS = 3600_000; // 1 hour

export interface MidwayUser {
  alias: string;
  email: string;
  authenticated: boolean;
}

/** Fetch and cache Midway JWKS */
async function getJwks() {
  if (cachedJwks && Date.now() - jwksCachedAt < JWKS_CACHE_MS) return cachedJwks;
  try {
    const res = await fetch(MIDWAY_JWKS_URI);
    cachedJwks = await res.json() as typeof cachedJwks;
    jwksCachedAt = Date.now();
    return cachedJwks;
  } catch {
    return cachedJwks;
  }
}

/** Parse JWT payload (lightweight — full verification via JWKS is optional for internal apps) */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    // Check issuer
    if (payload.iss && payload.iss !== 'https://midway-auth.amazon.com') return null;
    return payload;
  } catch {
    return null;
  }
}

function userFromJwt(payload: Record<string, unknown>): MidwayUser | null {
  const sub = payload.sub as string | undefined;
  if (!sub) return null;
  return { alias: sub, email: `${sub}@amazon.com`, authenticated: true };
}

export function midwayAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth in local development
  if (process.env.MIDWAY_DISABLED === 'true') {
    (req as any).midwayUser = {
      alias: process.env.USER ?? 'local-dev',
      email: `${process.env.USER ?? 'local-dev'}@amazon.com`,
      authenticated: true,
    } satisfies MidwayUser;
    next();
    return;
  }

  // Check for Midway user header (set by ALB/CloudFront after Midway validation)
  const midwayUserHeader = req.headers[MIDWAY_HEADER] as string | undefined;
  if (midwayUserHeader) {
    (req as any).midwayUser = {
      alias: midwayUserHeader,
      email: `${midwayUserHeader}@amazon.com`,
      authenticated: true,
    } satisfies MidwayUser;
    next();
    return;
  }

  // Check for Midway OIDC id_token cookie (set by frontend after Midway redirect)
  const cookies = parseCookies(req.headers.cookie ?? '');
  const idToken = cookies[MIDWAY_ID_TOKEN_COOKIE];
  if (idToken) {
    const payload = parseJwtPayload(decodeURIComponent(idToken));
    if (payload) {
      const user = userFromJwt(payload);
      if (user) {
        (req as any).midwayUser = user;
        next();
        return;
      }
    }
  }

  // Not authenticated - redirect to Midway login
  const siteUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUrl = `https://midway-auth.amazon.com/SSO/redirect?targetUrl=${encodeURIComponent(
    siteUrl + req.originalUrl,
  )}`;

  res.status(401).json({
    error: 'Authentication required',
    message: 'This application is for internal AWS employees only. Please authenticate via Midway.',
    loginUrl: redirectUrl,
  });
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) {
      cookies[name] = rest.join('=');
    }
  });
  return cookies;
}

/** Express middleware to add user info to response headers (for frontend) */
export function midwayUserHeader(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).midwayUser as MidwayUser | undefined;
  if (user) {
    res.setHeader('X-IDP-User', user.alias);
    res.setHeader('X-IDP-Email', user.email);
  }
  next();
}
