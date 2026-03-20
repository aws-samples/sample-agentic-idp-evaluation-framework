import { Router } from 'express';
import type { ConversationRequest } from '@idp/shared';
import { config } from '../config/aws.js';
import { initSSE, startKeepalive, endSSE } from '../services/streaming.js';

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as ConversationRequest;

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    // Proxy to agent server (local HTTP or AgentCore)
    const agentUrl = config.agentUrl;
    const agentRes = await fetch(`${agentUrl}/conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: body.message,
        history: body.history,
        documentId: body.documentId,
        s3Uri: body.s3Uri,
      }),
    });

    if (!agentRes.ok || !agentRes.body) {
      throw new Error(`Agent server error: ${agentRes.status}`);
    }

    // Stream SSE from agent server to client
    const reader = agentRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }
  } catch (err) {
    console.error('[Conversation Proxy Error]', err);
    res.write(`data: ${JSON.stringify({ type: 'text', data: 'I encountered an error. Please try again.' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } finally {
    endSSE(res, keepalive);
  }
});

export default router;
