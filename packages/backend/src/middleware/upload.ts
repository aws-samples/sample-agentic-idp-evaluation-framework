import multer from 'multer';
import { getAllAcceptedMimeTypes } from '@idp/shared';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ACCEPTED_MIME_TYPES = getAllAcceptedMimeTypes();

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported. Accepted types: ${ACCEPTED_MIME_TYPES.join(', ')}`));
    }
  },
});
