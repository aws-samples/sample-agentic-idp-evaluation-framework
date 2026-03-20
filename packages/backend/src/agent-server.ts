/**
 * Standalone Agent Server
 * Runs the Strands Socratic Agent as an independent service.
 * Local: http://localhost:3002
 * Production: AgentCore runtime container
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import express from 'express';
import { runSocraticAgentStrands, type SocraticAgentOptions } from './agents/socratic-agent-strands.js';
import { initSSE, emitSSE, startKeepalive, endSSE } from './services/streaming.js';
import type { ConversationEvent } from '@idp/shared';

const app = express();
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'idp-agent', timestamp: new Date().toISOString() });
});

interface AgentRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
  documentId?: string;
  s3Uri?: string;
}

// Agent conversation endpoint — SSE streaming
app.post('/conversation', async (req, res) => {
  const body = req.body as AgentRequest;

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

    await runSocraticAgentStrands(res, userText, body.history, options);

    const doneEvent: ConversationEvent = { type: 'done' };
    emitSSE(res, doneEvent);
  } catch (err) {
    console.error('[Agent Server Error]', err);
    emitSSE(res, { type: 'text', data: 'I encountered an error processing your request. Please try again.' });
    emitSSE(res, { type: 'done' });
  } finally {
    endSSE(res, keepalive);
  }
});

const port = parseInt(process.env.AGENT_PORT ?? '3002', 10);
app.listen(port, () => {
  console.log(`IDP Agent Server running on port ${port}`);
  console.log(`Health: http://localhost:${port}/health`);
});
