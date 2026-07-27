import type { Request, Response, NextFunction } from 'express';

/**
 * Reject a malformed request body BEFORE any route touches it.
 *
 * Every SSE route casts `req.body as SomeRequest` and then dereferences the fields the
 * type promises. A cast is not a check, so a request missing one field reached
 * `body.message.substring(0, 200)` and threw a TypeError — and because that happened in a
 * `router.post` handler *outside* any try/catch, with no `uncaughtException` handler
 * anywhere, **it killed the Node process**. Every other user's in-flight SSE stream died
 * with it, ECS restarted the task, and the browser showed "I encountered an issue
 * processing your request" — which reads like a model failure rather than a crashed server.
 *
 * Observed live: the CDK deployment was mid-restart when a user hit it. Nothing about the
 * bug is CDK-specific; the Terraform stack crashes identically on the same input. It is a
 * one-line unguarded field access reachable by anyone who can POST.
 *
 * So: validate at the edge, return 400 with a message naming the missing field, and never
 * let a bad body reach a handler.
 */

/** A field's expected shape. Deliberately tiny — this is a guard, not a schema library. */
type FieldSpec = 'string' | 'string?' | 'array' | 'array?' | 'object?';

export interface BodySpec {
  [field: string]: FieldSpec;
}

function describe(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function check(value: unknown, spec: FieldSpec): boolean {
  const optional = spec.endsWith('?');
  if (value === undefined || value === null) return optional;
  switch (spec.replace('?', '')) {
    case 'string': return typeof value === 'string';
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && !Array.isArray(value);
    default: return true;
  }
}

/**
 * Express middleware asserting the body matches `spec`.
 *
 * Returns a plain JSON 400 rather than opening an SSE stream first. Ordering matters: the
 * conversation route called `trackActivity` (which read `body.message`) BEFORE `initSSE`,
 * so the crash happened before a single byte was written — the client saw a 502 from the
 * load balancer, with no SSE frame explaining anything.
 */
export function validateBody(spec: BodySpec) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const problems: string[] = [];

    for (const [field, fieldSpec] of Object.entries(spec)) {
      if (!check(body[field], fieldSpec)) {
        const want = fieldSpec.replace('?', '');
        problems.push(`\`${field}\` must be ${want === 'array' ? 'an array' : `a ${want}`} (got ${describe(body[field])})`);
      }
    }

    if (problems.length > 0) {
      res.status(400).json({
        error: 'Invalid request body',
        detail: problems.join('; '),
      });
      return;
    }
    next();
  };
}
