import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import express from 'express';
import { corsMiddleware } from './middleware/cors.js';
import { midwayAuth, midwayUserHeader } from './middleware/midway.js';
import { errorHandler } from './middleware/error.js';
import { processRateLimit, apiRateLimit } from './middleware/rate-limit.js';
import { config } from './config/aws.js';
import { getLocalFilePath } from './services/s3.js';
import authRouter from './routes/auth.js';
import healthRouter from './routes/health.js';
import uploadRouter from './routes/upload.js';
import conversationRouter from './routes/conversation.js';
import processRouter from './routes/process.js';
import architectureRouter from './routes/architecture.js';
import pipelineRouter from './routes/pipeline.js';
import pipelineSmartRouter from './routes/pipeline-smart.js';
import previewRouter from './routes/preview.js';

const app = express();

// Middleware
app.use(corsMiddleware);
app.use(express.json({ limit: '50mb' }));

// Midway authentication (internal AWS employees only)
// Set MIDWAY_DISABLED=true in .env for local development
app.use('/api', midwayAuth);
app.use('/api', midwayUserHeader);

// Local file serving (dev mode - when S3 is not configured)
app.get('/api/files/*', (req, res) => {
  const key = decodeURIComponent(req.path.replace('/api/files/', ''));
  const filePath = getLocalFilePath(key);
  if (filePath) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Rate limiting (#24)
app.use('/api/process', processRateLimit);
app.use('/api/preview', processRateLimit);
app.use('/api/pipeline/execute', processRateLimit);
app.use('/api', apiRateLimit);

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/health', healthRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/conversation', conversationRouter);
app.use('/api/process', processRouter);
app.use('/api/architecture', architectureRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/pipeline/smart', pipelineSmartRouter);
app.use('/api/preview', previewRouter);

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
  if (process.env.MIDWAY_DISABLED === 'true') warnings.push('Midway auth DISABLED (dev mode)');

  if (warnings.length > 0) {
    console.warn('⚠ Environment warnings:');
    warnings.forEach((w) => console.warn(`  - ${w}`));
  }
  console.log(`Health check: GET http://localhost:${config.port}/api/health/detailed`);
});

export default app;
