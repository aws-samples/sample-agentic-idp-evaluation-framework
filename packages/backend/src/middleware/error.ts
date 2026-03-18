import type { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[Error]', err.message);

  if (err.message === 'Only PDF files are allowed') {
    res.status(400).json({ error: err.message });
    return;
  }

  if ('code' in err && (err as NodeJS.ErrnoException).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large. Maximum size is 50MB.' });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
}
