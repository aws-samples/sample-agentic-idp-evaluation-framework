---
title: Authentication
description: Pluggable auth — none or cognito.
---

ONE IDP ships with two pluggable auth backends. The choice is controlled by a single environment variable, `AUTH_PROVIDER`. Everything else is middleware.

## The two modes

| Mode | `AUTH_PROVIDER` | Use case | Admin endpoints |
|---|---|---|---|
| **Demo** | `none` | Local dev, customer demo with no login. | Always `403`. |
| **Cognito** | `cognito` | Public/customer deployments with real JWT validation. | Granted iff `cognito:username`/`username` ∈ `ADMIN_USERS`. |

## How `none` mode works

- Every request gets a synthetic `AuthUser { alias: 'anonymous' }` attached.
- No token validation, no cookie parsing.
- **Production safeguard**: `assertSafeAuthConfig()` runs at boot and **throws** when `NODE_ENV=production` + `AUTH_PROVIDER=none` unless `ALLOW_UNAUTHENTICATED=true` is explicitly set.
- Admin endpoints always deny in this mode, even if your alias looks like it should match `ADMIN_USERS` — the `requireAdmin` middleware refuses as a defense-in-depth.

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

## The admin gate

`requireAdmin` middleware (in `packages/backend/src/middleware/auth.ts`) applies all three of:

1. `AUTH_PROVIDER` ≠ `none` (hard floor).
2. `ADMIN_USERS` is non-empty.
3. `req.user.alias` ∈ `ADMIN_USERS`.

All three must hold. Losing any one returns `403`.

## Rate limiting interaction

Rate limiting is keyed by **user alias** when available (falls back to IP). This means:

- Multiple shared-IP users (NAT, office network) don't starve each other.
- A logged-in user gets higher default limits than an anonymous one.

See `packages/backend/src/middleware/rate-limit.ts` for the exact keying.

## Trust boundary summary

```
Internet
   │
   ▼
CloudFront  ◄──── HTTPS termination, origin routing
   │
   ▼  (HTTPS + TLS)
App Runner  ◄──── auth middleware runs here, not at the edge
   │
   ▼
Strands agent on AgentCore  ◄──── invoked with SigV4 by App Runner, not by the browser
```
