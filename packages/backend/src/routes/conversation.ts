import { Router } from 'express';
import type { ConversationRequest, ConversationEvent } from '@idp/shared';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as ConversationRequest;

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    const isInit = body.message === '__init__';
    const userText = isInit
      ? 'I just uploaded this document. Please analyze it and tell me what you see, then ask me what I want to do with it. Provide clickable options.'
      : body.message;

    // Always use Strands agent for agentic orchestration
    const { runSocraticAgentStrands } = await import('../agents/socratic-agent-strands.js');
    const history = body.history.map((h) => ({ role: h.role, content: h.content }));
    await runSocraticAgentStrands(res, userText, history, {
      documentId: body.documentId,
      s3Uri: body.s3Uri,
    });

    const doneEvent: ConversationEvent = { type: 'done' };
    emitSSE(res, doneEvent);
  } catch (err) {
    console.error('[Conversation Error]', err);
    emitSSE(res, { type: 'text', data: 'I encountered an error processing your request. Please try again.' });
    emitSSE(res, { type: 'done' });
  } finally {
    endSSE(res, keepalive);
  }
});

export default router;
