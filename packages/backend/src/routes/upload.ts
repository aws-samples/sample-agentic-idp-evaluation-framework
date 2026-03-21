import { Router } from 'express';
import type { UploadResponse } from '@idp/shared';
import { getDocumentType } from '@idp/shared';
import { upload } from '../middleware/upload.js';
import { uploadDocument, getPresignedUrl } from '../services/s3.js';
import type { MidwayUser } from '../middleware/midway.js';
import { trackActivity } from '../services/activity-tracker.js';

const router = Router();

function estimatePageCount(buffer: Buffer, fileName: string): number {
  const docType = getDocumentType(fileName);

  // For PDFs, count page markers
  if (docType === 'pdf') {
    const content = buffer.toString('binary');
    const matches = content.match(/\/Type\s*\/Page(?!s)/g);
    return matches ? matches.length : 1;
  }

  // For images, assume 1 page
  if (docType === 'image') {
    return 1;
  }

  // For Office documents, estimate (would need proper parsing for accuracy)
  // For now, return 1 as placeholder
  return 1;
}

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const userAlias = (req as any).midwayUser?.alias as string | undefined;
    // multer encodes originalname as Latin-1; decode to UTF-8 for Korean/CJK filenames
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf-8');
    const { documentId, s3Uri } = await uploadDocument(
      req.file.buffer,
      fileName,
      userAlias,
    );

    const pageCount = estimatePageCount(req.file.buffer, fileName);
    const previewUrl = await getPresignedUrl(s3Uri);
    const documentType = getDocumentType(fileName);

    const response: UploadResponse = {
      documentId,
      s3Uri,
      fileName,
      fileSize: req.file.size,
      pageCount,
      previewUrl,
      documentType: documentType ?? undefined,
    };

    res.json(response);

    // Track upload activity (non-blocking)
    trackActivity(userAlias ?? 'anonymous', 'upload', {
      documentId,
      fileName,
      s3Uri,
      details: { fileSize: req.file.size, pageCount, documentType },
    });
  } catch (err) {
    console.error('[Upload Error]', err);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

export default router;
