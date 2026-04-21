import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import express from 'express';
import { corsMiddleware } from './middleware/cors.js';
import { authMiddleware, authUserHeader, assertSafeAuthConfig } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { processRateLimit, apiRateLimit } from './middleware/rate-limit.js';
import { config } from './config/aws.js';
import { getLocalFilePath, getDocumentBuffer } from './services/s3.js';
import authRouter from './routes/auth.js';
import healthRouter from './routes/health.js';
import uploadRouter from './routes/upload.js';
import conversationRouter from './routes/conversation.js';
import processRouter from './routes/process.js';
import architectureRouter from './routes/architecture.js';
import architectureCodeRouter from './routes/architecture-code.js';
import pipelineRouter from './routes/pipeline.js';
import pipelineSmartRouter from './routes/pipeline-smart.js';
import pipelineChatRouter from './routes/pipeline-chat.js';
import previewRouter from './routes/preview.js';
import adminRouter from './routes/admin.js';

const app = express();

// Middleware
app.use(corsMiddleware);
app.use(express.json({ limit: '50mb' }));

// Health check before auth (App Runner / ALB health checks need unauthenticated access)
app.use('/api/health', healthRouter);

// Authentication (pluggable: midway | cognito | none)
// Configure via AUTH_PROVIDER env var. `MIDWAY_DISABLED=true` forces `none`.
assertSafeAuthConfig();
app.use('/api', authMiddleware);
app.use('/api', authUserHeader);

// File serving proxy (local files or S3).
// Keys are user-influenced — sanitize before touching either backend.
app.get('/api/files/*', async (req, res) => {
  const key = decodeURIComponent(req.path.replace('/api/files/', ''));

  // Reject keys that look like path traversal, absolute paths, or null bytes.
  // Legitimate keys are always `uploads/<alias>/<uuid>/<filename>` or similar.
  if (
    !key ||
    key.includes('\u0000') ||
    key.startsWith('/') ||
    key.split('/').some((seg) => seg === '..' || seg === '.')
  ) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  // Try local file first
  const filePath = getLocalFilePath(key);
  if (filePath) {
    res.sendFile(filePath);
    return;
  }

  // Proxy from S3
  try {
    const s3Uri = `s3://${config.s3Bucket}/${key}`;
    const buffer = await getDocumentBuffer(s3Uri);
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      mp4: 'video/mp4', mp3: 'audio/mpeg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    res.set('Content-Type', mimeTypes[ext] ?? 'application/octet-stream');
    res.set('Content-Length', String(buffer.length));
    res.set('Content-Disposition', 'inline');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (err: any) {
    if (err.Code === 'NoSuchKey' || err.name === 'NoSuchKey') {
      res.status(404).json({ error: 'File not found' });
    } else {
      console.error('[File proxy error]', err.message);
      res.status(500).json({ error: 'Failed to retrieve file' });
    }
  }
});

// Rate limiting (#24)
app.use('/api/process', processRateLimit);
app.use('/api/preview', processRateLimit);
app.use('/api/pipeline/execute', processRateLimit);
app.use('/api', apiRateLimit);

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/conversation', conversationRouter);
app.use('/api/process', processRouter);
app.use('/api/architecture', architectureRouter);
app.use('/api/architecture/code', architectureCodeRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/pipeline/smart', pipelineSmartRouter);
app.use('/api/pipeline/chat', pipelineChatRouter);
app.use('/api/preview', previewRouter);
app.use('/api/admin', adminRouter);

// Static frontend serving (production mode)
const frontendDist = resolve(__dirname, '../../frontend/dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(frontendDist, 'index.html'));
    }
  });
}

// Error handling
app.use(errorHandler);

app.listen(config.port, () => {
  const mode = existsSync(frontendDist) ? 'production (serving frontend)' : 'development';
  console.log(`ONE IDP Backend running on port ${config.port} [${mode}]`);

  // Startup environment validation (#23)
  const warnings: string[] = [];
  if (!config.region) warnings.push('AWS_REGION not set');
  if (!config.s3Bucket && process.env.USE_LOCAL_STORAGE !== 'true') warnings.push('S3_BUCKET not set (use USE_LOCAL_STORAGE=true for dev)');
  if (!config.claudeModelId) warnings.push('CLAUDE_MODEL_ID not set');
  if (!config.bdaProfileArn) warnings.push('BDA_PROFILE_ARN not set (BDA Standard unavailable)');
  if (!config.bdaProjectArn) warnings.push('BDA_PROJECT_ARN not set (BDA Custom unavailable)');
  const effectiveProvider = process.env.MIDWAY_DISABLED === 'true' ? 'none' : config.authProvider;
  if (effectiveProvider === 'none') warnings.push(`Auth DISABLED (AUTH_PROVIDER=none) — demo mode only`);
  else warnings.push(`Auth provider: ${effectiveProvider}`);

  if (warnings.length > 0) {
    console.warn('⚠ Environment warnings:');
    warnings.forEach((w) => console.warn(`  - ${w}`));
  }
  console.log(`Health check: GET http://localhost:${config.port}/api/health/detailed`);
});

export default app;
