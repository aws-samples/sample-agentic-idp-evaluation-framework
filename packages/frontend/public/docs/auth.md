---
title: Authentication
description: Pluggable auth — none, midway, or cognito.
---

# Authentication

ONE IDP ships with three pluggable auth backends. The choice is controlled by a single environment variable, `AUTH_PROVIDER`. Everything else is middleware.

## The three modes

| Mode | `AUTH_PROVIDER` | Use case | Admin endpoints |
|---|---|---|---|
| **Demo** | `none` | Local dev, customer demo with no login. | Always `403`. |
| **Midway** | `midway` | AWS-internal deployments behind a Midway-terminating edge. | Granted iff alias ∈ `ADMIN_USERS`. |
| **Cognito** | `cognito` | Public/customer deployments with real JWT validation. | Granted iff `cognito:username`/`username` ∈ `ADMIN_USERS`. |

## How `none` mode works

- Every request gets a synthetic `AuthUser { alias: 'anonymous' }` attached.
- No token validation, no cookie parsing.
- **Production safeguard**: `assertSafeAuthConfig()` runs at boot and **throws** when `NODE_ENV=production` + `AUTH_PROVIDER=none` unless `ALLOW_UNAUTHENTICATED=true` is explicitly set. This is a fail-closed check to stop you from accidentally shipping an unauthenticated admin surface.
- Admin endpoints always deny in this mode, even if your alias looks like it should match `ADMIN_USERS` — the `requireAdmin` middleware refuses as a defense-in-depth.

## How `midway` mode works

- Validates the `midway-id-token` cookie (JWT payload) **or** the `x-midway-user` header.
- The `x-midway-user` header is only trustworthy when the request came through a Midway-terminating edge (CloudFront in the live deployment) that strips this header on ingress. This trust boundary is documented inline in `packages/backend/src/middleware/midway.ts`.
- Legacy alias: `MIDWAY_DISABLED=true` behaves like `AUTH_PROVIDER=none` (kept for backwards compat with older deployments).

For AWS-internal use only. External customers should use Cognito.

## How `cognito` mode works

- Uses the `jose` v6 library to call `jwtVerify` against the user pool's **live JWKS**.
- Validates `iss`, `exp`, `token_use` (must be `id` or `access`), and — if configured — the `client_id` or `aud` claim against a comma-separated allowlist in `COGNITO_CLIENT_ID`.
- Accepts either ID tokens or access tokens.
- User alias is pulled from `cognito:username` (preferred) or `username`, and that's what `ADMIN_USERS` compares against.

### Required env

```
AUTH_PROVIDER=cognito
COGNITO_USER_POOL_ID=us-west-2_abc123
COGNITO_CLIENT_ID=abc,def      # optional: allowlist of client IDs
ADMIN_USERS=alice,bob           # comma-separated aliases
```

### Frontend integration

The frontend's `services/midway.ts` handles the Midway OIDC implicit flow. For Cognito you'll want a small analog — usually Amplify UI or the Cognito Hosted UI pointing back at `/auth/callback`. The backend's `authedFetch` helper in `services/api.ts` forwards whatever token the `midwayIdToken` localStorage key contains, so plugging in a different token source is a one-line change.

## The admin gate

`requireAdmin` middleware (in `packages/backend/src/middleware/auth.ts`) applies *all three* of:

1. `AUTH_PROVIDER` ≠ `none` (hard floor).
2. `ADMIN_USERS` is non-empty.
3. `req.user.alias` ∈ `ADMIN_USERS`.

All three must hold. Losing any one returns `403`.

## Rate limiting interaction

Rate limiting is keyed by **user alias** when available (falls back to IP). This means:

- Multiple shared-IP users (NAT, office network) don't starve each other.
- A logged-in user gets higher default limits than an anonymous one.

See `packages/backend/src/middleware/rate-limit.ts` for the exact keying.

## What you'll see in the UI

- With `AUTH_PROVIDER=none`, the top nav shows "Anonymous" and hides any admin links.
- With `midway` or `cognito`, the top nav shows your alias and the Admin link appears for admins (visually separated by a divider — see `SideNav.tsx`).
- Trying to `POST /api/admin/*` while not authorized returns a JSON error with an explicit message so frontend code can show a friendly toast.

## Trust boundary summary

```
Internet
   │
   ▼
CloudFront  ◄──── strips inbound x-midway-user, x-forwarded-*, etc. (Midway mode)
   │
   ▼  (HTTPS + TLS)
App Runner  ◄──── auth middleware runs here, not at the edge
   │
   ▼
Strands agent on AgentCore  ◄──── invoked with SigV4 by App Runner, not by the browser
```

Never point the browser at App Runner directly in Midway mode — `x-midway-user` becomes user-supplied and auth breaks.
