/**
 * Midway OIDC Implicit Flow Authentication
 *
 * Uses Midway's OpenID Connect endpoint to authenticate AWS internal employees.
 * Flow: redirect to Midway → user authenticates → redirect back with id_token in URL fragment
 */

const MIDWAY_ISSUER = 'https://midway-auth.amazon.com';
const MIDWAY_AUTH_ENDPOINT = `${MIDWAY_ISSUER}/SSO/redirect`;
const MIDWAY_JWKS_URI = `${MIDWAY_ISSUER}/jwks.json`;
const TOKEN_COOKIE = 'midway-id-token';

/** Parse JWT payload without verification (verification done server-side) */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** Get stored id_token from cookie */
export function getStoredToken(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Store id_token in cookie */
function storeToken(token: string): void {
  const payload = parseJwtPayload(token);
  const exp = payload?.exp as number | undefined;
  const maxAge = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 3600;
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${maxAge}; secure; samesite=lax`;
}

/** Clear stored token */
export function clearToken(): void {
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0`;
}

/** Extract user info from id_token */
export function getUserFromToken(token: string): { alias: string; email: string } | null {
  const payload = parseJwtPayload(token);
  if (!payload) return null;

  const sub = payload.sub as string | undefined;
  if (!sub) return null;

  return {
    alias: sub,
    email: `${sub}@amazon.com`,
  };
}

/** Check if we have a valid (non-expired) token */
export function hasValidToken(): boolean {
  const token = getStoredToken();
  if (!token) return false;

  const payload = parseJwtPayload(token);
  if (!payload) return false;

  const exp = payload.exp as number | undefined;
  if (exp && exp < Math.floor(Date.now() / 1000)) {
    clearToken();
    return false;
  }

  return true;
}

/** Handle the OIDC callback — extract id_token from URL query or hash */
export function handleOidcCallback(): boolean {
  // Midway returns id_token as query param or hash fragment depending on config
  const queryParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const idToken = queryParams.get('id_token') || hashParams.get('id_token');
  if (!idToken) return false;

  storeToken(idToken);

  // Clean up URL (remove token from URL)
  window.history.replaceState(null, '', window.location.pathname);

  return true;
}

/** Generate a random nonce for OIDC */
function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/** Redirect to Midway for authentication */
export function redirectToMidway(): void {
  const currentUrl = window.location.origin + window.location.pathname;
  const clientId = `${window.location.origin}:443`;
  const nonce = generateNonce();
  sessionStorage.setItem('midway-nonce', nonce);
  const authUrl = `${MIDWAY_AUTH_ENDPOINT}?response_type=id_token&client_id=${encodeURIComponent(clientId)}&scope=openid&nonce=${nonce}&redirect_uri=${encodeURIComponent(currentUrl)}`;
  window.location.href = authUrl;
}

/** Check if running in local dev mode */
function isLocalDev(): boolean {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

/** Initialize Midway auth — call on app startup */
export function initMidwayAuth(): { alias: string; email: string } | null {
  // Local dev: skip Midway, use mock user
  if (isLocalDev()) {
    return { alias: 'local-dev', email: 'local-dev@amazon.com' };
  }

  // Step 1: Check for OIDC callback (returning from Midway)
  if (handleOidcCallback()) {
    const token = getStoredToken();
    if (token) return getUserFromToken(token);
  }

  // Step 2: Check existing token
  if (hasValidToken()) {
    const token = getStoredToken()!;
    return getUserFromToken(token);
  }

  // Step 3: No valid token — redirect to Midway
  redirectToMidway();
  return null;
}
