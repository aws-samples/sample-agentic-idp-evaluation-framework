import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config/aws.js';
import type { AuthUser } from './auth.js';

/**
 * Cognito JWT authentication middleware.
 *
 * Validates the `Authorization: Bearer <id_token>` header against a
 * Cognito user pool's published JWKS, then extracts a user identity
 * from the `cognito:username` (or `sub`) and `email` claims.
 *
 * Configure via env:
 *   COGNITO_USER_POOL_ID  — e.g. us-west-2_ABCDEFG
 *   COGNITO_CLIENT_ID     — app client ID(s), comma-separated
 *
 * Accepts either an ID token or an access token. For access tokens,
 * `email` is typically absent; we fall back to `<username>@unknown`.
 */

const poolId = process.env.COGNITO_USER_POOL_ID ?? '';
const clientIds = (process.env.COGNITO_CLIENT_ID ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const region = config.region;

const issuer = poolId ? `https://cognito-idp.${region}.amazonaws.com/${poolId}` : '';
const jwksUri = poolId ? `${issuer}/.well-known/jwks.json` : '';

const jwks = poolId ? createRemoteJWKSet(new URL(jwksUri)) : null;

function toUser(payload: Record<string, unknown>): AuthUser {
  const alias = (payload['cognito:username'] as string) ?? (payload.username as string) ?? (payload.sub as string) ?? 'unknown';
  const email = (payload.email as string) ?? `${alias}@unknown`;
  return { alias, email, authenticated: true };
}

export async function cognitoAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!poolId || !jwks) {
    res.status(500).json({
      error: 'Auth misconfigured',
      message: 'AUTH_PROVIDER=cognito but COGNITO_USER_POOL_ID is unset.',
    });
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Authentication required', message: 'Missing Bearer token.' });
    return;
  }
  const token = match[1];

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer });

    // token_use must be id or access; audience check depends on which.
    const tokenUse = payload['token_use'] as string | undefined;
    if (tokenUse !== 'id' && tokenUse !== 'access') {
      res.status(401).json({ error: 'Invalid token', message: `Unexpected token_use: ${tokenUse}` });
      return;
    }

    if (clientIds.length > 0) {
      // For ID tokens, audience = client_id. For access tokens, `client_id` claim.
      const clientClaim = tokenUse === 'id' ? payload.aud : (payload['client_id'] as string | undefined);
      const clientValues = Array.isArray(clientClaim) ? clientClaim : [clientClaim];
      if (!clientValues.some((c) => typeof c === 'string' && clientIds.includes(c))) {
        res.status(401).json({ error: 'Invalid token', message: 'Client ID not allowed.' });
        return;
      }
    }

    const user = toUser(payload as Record<string, unknown>);
    (req as unknown as { authUser: AuthUser }).authUser = user;
    next();
  } catch (err) {
    res.status(401).json({
      error: 'Authentication required',
      message: err instanceof Error ? err.message : 'Invalid token.',
    });
  }
}
