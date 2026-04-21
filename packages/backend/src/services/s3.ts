import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { s3Client, config } from '../config/aws.js';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { dirname, join, resolve, sep, basename } from 'path';
import { existsSync } from 'fs';

// macOS uses NFD (decomposed) for Korean/CJK filenames; S3 keys must be NFC (composed).
// Also strip path separators / null bytes / control chars so a user-supplied filename
// can never escape the `uploads/<alias>/<uuid>/` prefix on either S3 or the local FS.
function normalizeFileName(name: string): string {
  const base = basename(name).normalize('NFC');
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f/\\]/g, '_') || 'upload';
}

const LOCAL_STORAGE_DIR = join(process.cwd(), '.local-uploads');

function useLocal(): boolean {
  return !config.s3Bucket || config.s3Bucket.includes('ACCOUNT_ID') || process.env.USE_LOCAL_STORAGE === 'true';
}

function parseS3Uri(s3Uri: string): { bucket: string; key: string } {
  const url = new URL(s3Uri);
  return { bucket: url.hostname, key: decodeURIComponent(url.pathname.slice(1)) };
}

export async function uploadDocument(
  file: Buffer,
  fileName: string,
  userAlias?: string,
): Promise<{ documentId: string; s3Uri: string }> {
  const documentId = uuidv4();
  const userPrefix = userAlias ? `${userAlias}/` : '';
  const key = `uploads/${userPrefix}${documentId}/${normalizeFileName(fileName)}`;

  if (useLocal()) {
    const localPath = join(LOCAL_STORAGE_DIR, key);
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, file);
    const s3Uri = `local://${config.s3Bucket}/${key}`;
    return { documentId, s3Uri };
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      Body: file,
      ContentType: 'application/octet-stream',
    }),
  );

  const s3Uri = `s3://${config.s3Bucket}/${key}`;
  return { documentId, s3Uri };
}

export async function getPresignedUrl(s3Uri: string): Promise<string> {
  // Always use backend proxy for file serving (avoids S3 presigned URL issues)
  const key = s3Uri.startsWith('local://')
    ? s3Uri.replace(/^local:\/\/[^/]*\//, '')
    : new URL(s3Uri).pathname.slice(1);
  const encoded = key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `/api/files/${encoded}`;
}

export async function getDocumentBuffer(s3Uri: string): Promise<Buffer> {
  if (s3Uri.startsWith('local://')) {
    const key = s3Uri.replace(/^local:\/\/[^/]*\//, '');
    const localPath = join(LOCAL_STORAGE_DIR, key);
    return readFile(localPath);
  }
  const { bucket, key } = parseS3Uri(s3Uri);
  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err: any) {
    // Fallback: try NFD (decomposed) key for files uploaded from macOS before NFC fix
    const errorCode = err.Code || err.name || err.$metadata?.httpStatusCode;
    if (errorCode === 'NoSuchKey' || errorCode === 404) {
      const nfdKey = key.normalize('NFD');
      if (nfdKey !== key) {
        console.log('[S3 NFD fallback] NFC key not found, trying NFD:', nfdKey.length, 'bytes vs NFC:', key.length);
        const response = await s3Client.send(
          new GetObjectCommand({ Bucket: bucket, Key: nfdKey }),
        );
        const bytes = await response.Body!.transformToByteArray();
        return Buffer.from(bytes);
      }
    }
    throw err;
  }
}

// Serve local files (for dev mode). Guards against path traversal by
// resolving the absolute path and verifying it stays inside LOCAL_STORAGE_DIR.
export function getLocalFilePath(key: string): string | null {
  // Reject null bytes + obvious traversal attempts up-front so the error is
  // cheap and the reason is obvious in logs.
  if (!key || key.includes('\u0000') || key.split('/').some((s) => s === '..')) return null;

  const candidate = resolve(LOCAL_STORAGE_DIR, key);
  const root = resolve(LOCAL_STORAGE_DIR) + sep;
  if (candidate !== resolve(LOCAL_STORAGE_DIR) && !candidate.startsWith(root)) return null;
  return existsSync(candidate) ? candidate : null;
}
