/**
 * Standalone Agent Server
 * Runs the Strands Socratic Agent as an independent service.
 * Local: http://localhost:3002
 * Production: AgentCore runtime container (port 8080, POST /invocations)
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import express, { type Request, type Response } from 'express';
import { runSocraticAgentStrands, type SocraticAgentOptions } from './agents/socratic-agent-strands.js';
import { initSSE, emitSSE, startKeepalive, endSSE } from './services/streaming.js';
import type { ConversationEvent } from '@idp/shared';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb', type: 'text/*' }));
// Accept raw binary payloads too (AgentCore sends raw bytes)
app.use(express.raw({ limit: '10mb', type: 'application/octet-stream' }));

// Health check (AgentCore also calls GET /health)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'idp-agent', timestamp: new Date().toISOString() });
});

interface AgentRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
  documentId?: string;
  s3Uri?: string;
}

// Shared conversation handler
async function conversationHandler(req: Request, res: Response): Promise<void> {
  let body: AgentRequest;
  if (Buffer.isBuffer(req.body)) {
    body = JSON.parse(req.body.toString('utf-8'));
  } else if (typeof req.body === 'string') {
    body = JSON.parse(req.body);
  } else {
    body = req.body as AgentRequest;
  }

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    const isInit = body.message === '__init__';
    const userText = isInit
      ? 'I just uploaded this document. Please analyze it and tell me what you see, then ask me what I want to do with it. Provide clickable options.'
      : body.message;

    const options: SocraticAgentOptions = {
      documentId: body.documentId,
      s3Uri: body.s3Uri,
    };

    console.log('[Agent Server] Processing conversation, documentId:', body.documentId, 's3Uri:', body.s3Uri);
    await runSocraticAgentStrands(res, userText, body.history ?? [], options);

    const doneEvent: ConversationEvent = { type: 'done' };
    emitSSE(res, doneEvent);
  } catch (err) {
    console.error('[Agent Server Error]', err);
    emitSSE(res, { type: 'text', data: 'I encountered an error processing your request. Please try again.' });
    emitSSE(res, { type: 'done' });
  } finally {
    endSSE(res, keepalive);
  }
}

// AgentCore HTTP protocol: POST /invocations (port 8080)
app.post('/invocations', (req, res) => {
  console.log('[Agent Server] AgentCore /invocations received');
  return conversationHandler(req, res);
});

// Also handle root POST (fallback)
app.post('/', (req, res) => {
  console.log('[Agent Server] Root POST received');
  return conversationHandler(req, res);
});

// Direct HTTP endpoint (local dev / HTTP proxy)
app.post('/conversation', (req, res) => {
  return conversationHandler(req, res);
});

// AgentCore uses port 8080 by default; local dev uses AGENT_PORT or 3002
const isAgentCore = process.env.SERVER_MODE === 'agent';
const port = parseInt(process.env.AGENT_PORT ?? (isAgentCore ? '8080' : '3002'), 10);
app.listen(port, () => {
  console.log(`IDP Agent Server running on port ${port}`);
  console.log(`Health: http://localhost:${port}/health`);
  console.log(`Mode: ${process.env.SERVER_MODE ?? 'standalone'}`);
  if (isAgentCore) {
    console.log(`AgentCore invocation endpoint: POST http://localhost:${port}/invocations`);
  }
});
