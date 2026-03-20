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

const MIDWAY_COOKIE_NAME = 'midway-auth';
const MIDWAY_HEADER = 'x-midway-user';

export interface MidwayUser {
  alias: string;
  email: string;
  authenticated: boolean;
}

function parseMidwayCookie(cookieValue: string): MidwayUser | null {
  try {
    // In production, Midway sets a signed cookie that the ALB/CloudFront validates.
    // The downstream service receives the user identity in headers.
    // This is a simplified parser for the forwarded identity.
    const decoded = Buffer.from(cookieValue, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (parsed.alias && parsed.email) {
      return {
        alias: parsed.alias,
        email: parsed.email,
        authenticated: true,
      };
    }
    return null;
  } catch {
    return null;
  }
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

  // Check for Midway cookie
  const cookies = parseCookies(req.headers.cookie ?? '');
  const midwayCookie = cookies[MIDWAY_COOKIE_NAME];
  if (midwayCookie) {
    const user = parseMidwayCookie(midwayCookie);
    if (user) {
      (req as any).midwayUser = user;
      next();
      return;
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
