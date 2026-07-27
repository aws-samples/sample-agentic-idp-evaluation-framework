import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * A malformed request body took the WHOLE SERVER DOWN.
 *
 * Every SSE route does `req.body as SomeRequest` and then dereferences the fields that type
 * promises. A cast is not a check. A POST to `/api/conversation` without `message` reached
 * `body.message.substring(0, 200)` and threw a TypeError — in an async `router.post` handler
 * outside any try/catch, with no `uncaughtException` handler anywhere, so Node printed the
 * stack and EXITED. Every other user's in-flight SSE stream died with it, ECS restarted the
 * task, and the browser showed "I encountered an issue processing your request", which reads
 * like a model failure rather than a crashed process.
 *
 * Seen in production on the CDK deployment, but nothing about it is CDK-specific: the
 * Terraform stack returns the same 502 on the same input. Confirmed live on both.
 *
 * Two independent layers now, because either alone is insufficient:
 *   1. validateBody rejects the known shape at the edge with a 400.
 *   2. process-level handlers keep the server alive if anything else throws.
 */
const SRC = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf-8');

/** Routes that stream SSE and dereference body fields. */
const GUARDED_ROUTES = [
  'routes/conversation.ts',
  'routes/preview.ts',
  'routes/process.ts',
  'routes/pipeline-chat.ts',
  'routes/pipeline-smart.ts',
];

describe('a malformed body cannot crash the server', () => {
  it.each(GUARDED_ROUTES)('%s validates its body before the handler runs', (file) => {
    const src = read(file);
    expect(src, `${file} does not import validateBody`).toMatch(/import \{ validateBody \}/);
    /*
     * The guard must be the FIRST argument after the path, so it runs before the handler.
     * The crash in conversation.ts happened in a `trackActivity` call placed ABOVE
     * `initSSE`, i.e. before a single byte was written — validation has to precede all of it.
     */
    expect(src, `${file} does not apply validateBody to its POST route`)
      .toMatch(/router\.post\('\/',\s*validateBody\(/);
  });

  it('declares the field that actually caused the crash', () => {
    // `message` and `history` are what conversation.ts dereferences unguarded.
    const src = read('routes/conversation.ts');
    const spec = src.slice(src.indexOf('validateBody('), src.indexOf('async (req, res)'));
    expect(spec).toMatch(/message:\s*'string'/);
    expect(spec).toMatch(/history:\s*'array'/);
  });

  it('finds no route that dereferences a body field without a guard', () => {
    /*
     * The general check: any `body.<field>.<method>()` in a route file is a crash waiting to
     * happen unless that file validates first. This is what would have caught the original
     * bug — there were 8 such accesses across 5 files.
     */
    const dir = join(SRC, 'routes');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, file), 'utf-8');
      const derefs = [...src.matchAll(/\bbody\.(\w+)\.(substring|map|join|length|split|filter)\b/g)];
      if (derefs.length === 0) continue;
      if (!src.includes('validateBody(')) {
        offenders.push(`${file}: ${derefs.map((m) => m[0]).join(', ')}`);
      }
    }
    expect(offenders, `unguarded body dereferences: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('keeps the process alive when something else throws', () => {
    /*
     * `errorHandler` only catches what Express routes to it. A throw inside an async handler
     * that already started streaming, or in a callback outside the request cycle, reaches the
     * process — where Node's default is to exit. Logging and staying up trades one failed
     * request for a guaranteed outage for every user.
     */
    const index = read('index.ts');
    expect(index).toMatch(/process\.on\('uncaughtException'/);
    expect(index).toMatch(/process\.on\('unhandledRejection'/);
    // Must NOT exit: that would reproduce the original outage.
    const block = index.slice(index.indexOf("process.on('uncaughtException'"), index.indexOf('app.listen'));
    expect(block, 'the handler must not exit the process').not.toMatch(/process\.exit/);
  });
});

describe('a transient Bedrock error is retried, not surfaced as a dead end', () => {
  const agent = read('agents/socratic-agent-strands.ts');

  it('retries the agent stream instead of failing on the first error', () => {
    /*
     * Measured live: Bedrock intermittently answers this agent with
     * `InternalServerException` (HTTP 500, `$fault: 'server'`). Two identical uploads — one
     * worked, one did not. The AWS SDK retried 3 times internally but its backoff totalled
     * 172ms, nowhere near long enough for a server-side blip, and the only handling was to
     * emit "I encountered an issue processing your request".
     */
    expect(agent).toMatch(/MAX_ATTEMPTS/);
    expect(agent).toMatch(/RETRYABLE/);
    expect(agent).toMatch(/InternalServerException/);
  });

  it('never retries after output has already streamed', () => {
    /*
     * The load-bearing safety condition. Restarting the stream once text has reached the
     * client would duplicate it mid-sentence in the transcript — a worse bug than the one
     * being fixed, and one the user would see rather than a log.
     */
    expect(agent).toMatch(/emittedAnything/);
    expect(agent, 'the retry must be gated on nothing having been emitted')
      .toMatch(/transient && !emittedAnything/);
  });

  it('backs off longer than the SDK already did', () => {
    // A retry with no delay just re-hits the same failing backend.
    expect(agent).toMatch(/setTimeout\(r, attempt \* 1000\)/);
  });

  it('tells the user what failed and what still works', () => {
    /*
     * "I encountered an issue processing your request" blamed the request. The document
     * uploaded fine and the question was valid — it was a Bedrock-side error. The message
     * now names that and points at "Skip questions, use defaults", which bypasses the
     * agent entirely.
     */
    expect(agent).toMatch(/Bedrock returned a temporary error/);
    expect(agent).toMatch(/Skip questions, use defaults/);
    // The old blame-the-user wording must not come back.
    const code = agent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/I encountered an issue processing your request/);
  });
});

describe('validateBody itself', () => {
  const src = readFileSync(join(SRC, 'middleware', 'validate-body.ts'), 'utf-8');

  it('answers with 400 and names the offending field', () => {
    // "Invalid request" with no detail sends the caller hunting; the field name is the fix.
    expect(src).toMatch(/status\(400\)/);
    expect(src).toMatch(/detail/);
  });

  it('rejects before any SSE stream is opened', () => {
    // Once initSSE has written headers, a 400 is no longer possible — the client would get a
    // 200 with a broken stream. So the middleware must answer with plain JSON.
    expect(src).toMatch(/res\.status\(400\)\.json/);
    // Strip comments: the docblock EXPLAINS why initSSE must not be used here, and
    // matching the word inside that explanation failed the correct implementation.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\binitSSE\(|\bemitSSE\(/);
  });

  it('treats optional fields as optional', () => {
    // s3Uri is genuinely optional on ConversationRequest; requiring it would break local
    // storage mode, where uploads never get an s3Uri.
    expect(src).toMatch(/optional/);
    expect(read('routes/conversation.ts')).toMatch(/s3Uri:\s*'string\?'/);
  });
});
