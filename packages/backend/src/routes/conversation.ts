import { Router } from 'express';
import type { ConversationRequest, ConversationEvent } from '@idp/shared';
import { InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { config, agentCoreClient } from '../config/aws.js';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';
import { trackActivity } from '../services/activity-tracker.js';

const router = Router();

// AgentCore invocation timeout (10s to get first response, then fall back)
const AGENTCORE_TIMEOUT_MS = 10_000;

router.post('/', async (req, res) => {
  const body = req.body as ConversationRequest;

  const userAlias = (req as any).authUser?.alias ?? 'anonymous';
  trackActivity(userAlias, body.message === '__init__' ? 'conversation_start' : 'conversation_message', {
    documentId: body.documentId,
    s3Uri: body.s3Uri,
    details: { message: body.message.substring(0, 200), historyLength: body.history.length },
  });

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    const isInit = body.message === '__init__';
    const userText = isInit
      ? 'I just uploaded this document. Please analyze it and tell me what you see, then ask me what I want to do with it. Provide clickable options.'
      : body.message;

    // Strategy 1: AgentCore SDK invocation (production)
    if (config.agentRuntimeArn) {
      try {
        console.log('[Conversation] Invoking AgentCore runtime:', config.agentRuntimeArn);
        const payload = JSON.stringify({
          message: body.message,
          history: body.history,
          documentId: body.documentId,
          s3Uri: body.s3Uri,
        });

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), AGENTCORE_TIMEOUT_MS);

        const command = new InvokeAgentRuntimeCommand({
          agentRuntimeArn: config.agentRuntimeArn,
          contentType: 'application/json',
          accept: 'text/event-stream',
          payload: new TextEncoder().encode(payload),
        });

        try {
          const agentRes = await agentCoreClient.send(command, {
            abortSignal: abortController.signal,
          });
          clearTimeout(timeout);

          if (agentRes.response) {
            console.log('[Conversation] AgentCore response received, streaming back');
            const stream = agentRes.response;
            if (typeof (stream as any).transformToWebStream === 'function') {
              const webStream = (stream as any).transformToWebStream() as ReadableStream;
              const reader = webStream.getReader();
              const decoder = new TextDecoder();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
              }
            } else if (typeof (stream as any).pipe === 'function') {
              await new Promise<void>((resolve, reject) => {
                (stream as any).on('data', (chunk: Buffer) => res.write(chunk));
                (stream as any).on('end', resolve);
                (stream as any).on('error', reject);
              });
            } else {
              const bytes = await (stream as any).transformToByteArray();
              res.write(Buffer.from(bytes));
            }
            return; // SSE complete via AgentCore
          }
          console.warn('[Conversation] AgentCore returned no response stream — falling back to direct');
        } catch (sendErr: any) {
          clearTimeout(timeout);
          if (sendErr.name === 'AbortError') {
            console.warn('[Conversation] AgentCore timed out after', AGENTCORE_TIMEOUT_MS, 'ms — falling back to direct');
          } else {
            throw sendErr;
          }
        }
      } catch (agentCoreErr: any) {
        console.warn('[Conversation] AgentCore invocation failed:', agentCoreErr.message, '— falling back to direct');
      }
    }

    // Strategy 2: HTTP proxy to agent server (local dev with separate agent process)
    if (config.agentUrl && config.agentUrl !== 'direct') {
      try {
        const agentRes = await fetch(`${config.agentUrl}/conversation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: body.message,
            history: body.history,
            documentId: body.documentId,
            s3Uri: body.s3Uri,
          }),
        });

        if (agentRes.ok && agentRes.body) {
          const reader = agentRes.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
          }
          return; // SSE complete via proxy
        }
        console.warn('[Conversation] Agent server returned', agentRes.status, '— falling back to direct');
      } catch (proxyErr) {
        console.warn('[Conversation] Agent server unavailable — falling back to direct');
      }
    }

    // Strategy 3: Direct in-process agent (fallback)
    console.log('[Conversation] Using direct in-process agent');
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
