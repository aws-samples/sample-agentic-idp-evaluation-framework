import type { Response } from 'express';

export function initSSE(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
}

export function emitSSE(res: Response, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function startKeepalive(res: Response): NodeJS.Timeout {
  return setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15_000);
}

export function endSSE(res: Response, keepalive: NodeJS.Timeout): void {
  clearInterval(keepalive);
  res.end();
}
