import type { Response } from 'express';

export function initSSE(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Disable proxy buffering so CloudFront / ALB / intermediaries flush
    // each chunk immediately; without this the idle-timer on the origin
    // connection can expire even though we're emitting keepalive comments.
    'X-Accel-Buffering': 'no',
  });
  // Flush the headers to the client immediately.
  (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();
}

function flush(res: Response): void {
  // Express may not expose .flush() unless compression middleware is active,
  // but Node's http.ServerResponse supports .flush() on the socket when
  // Connection: keep-alive + no Content-Length. Call it defensively.
  const f = (res as unknown as { flush?: () => void }).flush;
  if (typeof f === 'function') f.call(res);
}

export function emitSSE(res: Response, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  flush(res);
}

export function startKeepalive(res: Response): NodeJS.Timeout {
  return setInterval(() => {
    // Standard SSE heartbeat — a comment line. 15 s is well under typical
    // 60 s idle timeouts at CloudFront / ALB.
    res.write(': keepalive\n\n');
    flush(res);
  }, 15_000);
}

export function endSSE(res: Response, keepalive: NodeJS.Timeout): void {
  clearInterval(keepalive);
  res.end();
}
