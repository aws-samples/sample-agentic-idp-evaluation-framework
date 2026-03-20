/**
 * Standalone Agent Server
 * Runs the Strands Socratic Agent as an independent service.
 * Local: http://localhost:3002
 * Production: AgentCore runtime container (port 8080, POST /invocations)
 *
 * AgentCore HTTP protocol contract:
 * - GET /ping — health check (required)
 * - POST /invocations — agent invocation with raw binary payload (required)
 * See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html
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
// JSON for direct HTTP calls (local dev)
app.use(express.json({ limit: '10mb' }));

// Health check — AgentCore requires GET /ping
app.get('/ping', (_req, res) => {
  res.json({ status: 'Healthy', time_of_last_update: Math.floor(Date.now() / 1000) });
});
// Also keep /health for backwards compat
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
async function conversationHandler(body: AgentRequest, res: Response): Promise<void> {
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

// AgentCore HTTP protocol: POST /invocations with raw binary payload
// AgentCore sends Content-Type: application/octet-stream
app.post('/invocations', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  console.log('[Agent Server] /invocations received, content-type:', req.headers['content-type'], 'body type:', typeof req.body, 'isBuffer:', Buffer.isBuffer(req.body));
  let body: AgentRequest;
  if (Buffer.isBuffer(req.body)) {
    body = JSON.parse(req.body.toString('utf-8'));
  } else if (typeof req.body === 'string') {
    body = JSON.parse(req.body);
  } else {
    body = req.body as AgentRequest;
  }
  return conversationHandler(body, res);
});

// Direct HTTP endpoint (local dev / HTTP proxy)
app.post('/conversation', (req, res) => {
  return conversationHandler(req.body as AgentRequest, res);
});

// AgentCore uses port 8080 by default; local dev uses AGENT_PORT or 3002
const isAgentCore = process.env.SERVER_MODE === 'agent';
const port = parseInt(process.env.AGENT_PORT ?? (isAgentCore ? '8080' : '3002'), 10);
app.listen(port, () => {
  console.log(`IDP Agent Server running on port ${port}`);
  console.log(`Mode: ${process.env.SERVER_MODE ?? 'standalone'}`);
  console.log(`Endpoints:`);
  console.log(`  POST http://localhost:${port}/invocations`);
  console.log(`  GET  http://localhost:${port}/ping`);
  if (!isAgentCore) {
    console.log(`  POST http://localhost:${port}/conversation`);
  }
});
