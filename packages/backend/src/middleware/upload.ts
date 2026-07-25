import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { getAllAcceptedExtensions, getAllAcceptedMimeTypes, getDocumentType } from '@idp/shared';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ACCEPTED_MIME_TYPES = getAllAcceptedMimeTypes();

/** Marker so the error handler can tell a rejected type from a genuine fault. */
export class UnsupportedFileTypeError extends Error {
  readonly status = 415;
  constructor(readonly detail: string) {
    super(detail);
    this.name = 'UnsupportedFileTypeError';
  }
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    // Fall back to the extension. Browsers and HTTP clients frequently send
    // application/octet-stream or an empty type for perfectly valid files
    // (notably .csv, and anything uploaded from a drag-and-drop or a script), so
    // a MIME-only check rejected documents the app fully supports.
    if (getDocumentType(file.originalname)) {
      cb(null, true);
      return;
    }
    cb(new UnsupportedFileTypeError(
      `${file.originalname || 'This file'} is not a supported document type. `
      + `Accepted formats: ${getAllAcceptedExtensions().join(', ')}.`,
    ));
  },
});

/**
 * Turn upload rejections into an actionable 4xx.
 *
 * Without this, both a rejected file type and an oversized file reached the
 * generic Express error handler and came back as HTTP 500
 * `{"error":"Internal server error"}` — the UI showed "Upload failed" with no
 * indication of what was wrong or what to do, and the status implied a server
 * fault for what is a client-correctable request.
 */
export function handleUploadErrors(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof UnsupportedFileTypeError) {
    res.status(415).json({ error: err.detail });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `File is larger than the ${MAX_FILE_SIZE / (1024 * 1024)} MB limit.`
      : `Upload rejected: ${err.message}`;
    res.status(413).json({ error: message });
    return;
  }
  next(err);
}
