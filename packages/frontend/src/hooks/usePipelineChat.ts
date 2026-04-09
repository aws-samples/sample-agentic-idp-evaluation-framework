import { useState, useCallback, useRef } from 'react';
import type { PipelineChatEvent, PipelineDefinition, Capability } from '@idp/shared';
import type { ChatMessage } from './useConversation';
import { useSSE } from './useSSE';

export interface PipelineUpdate {
  pipeline: PipelineDefinition;
  alternatives: PipelineDefinition[];
}

export interface UsePipelineChatResult {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  pipelineUpdate: PipelineUpdate | null;
  sendMessage: (message: string) => void;
  addInitialMessage: (msg: ChatMessage) => void;
}

/** Strip control tags from display text */
function stripTags(text: string): string {
  return text
    .replace(/<pipeline_update>[\s\S]*?<\/pipeline_update>/g, '')
    .replace(/<options>[\s\S]*?<\/options>/g, '')
    .replace(/<(?:pipeline_update|options)[^>]*$/g, '')
    .trim();
}

/** Extract <options>[...]</options> from text */
function extractQuickReplies(text: string): string[] {
  const match = text.match(/<options>([\s\S]*?)<\/options>/);
  if (!match) return [];
  const content = match[1].trim();
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  const bracketItems = [...content.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  if (bracketItems.length > 1) return bracketItems;
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines
    .map((l) => l.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter((l) => l.length > 0 && l.length < 200);
}

function buildMessages(
  baseMessages: ChatMessage[],
  events: PipelineChatEvent[],
): { messages: ChatMessage[]; pipelineUpdate: PipelineUpdate | null; quickReplies: string[] } {
  const result: ChatMessage[] = [...baseMessages];
  let pipelineUpdate: PipelineUpdate | null = null;
  let assistantContent = '';
  let hasAssistant = false;

  for (const event of events) {
    switch (event.type) {
      case 'text':
        hasAssistant = true;
        assistantContent += event.data;
        break;
      case 'pipeline_update':
        pipelineUpdate = event.data;
        break;
      case 'done':
        break;
    }
  }

  let quickReplies: string[] = [];
  if (hasAssistant) {
    const isDone = events.some((e) => e.type === 'done');
    if (isDone) {
      quickReplies = extractQuickReplies(assistantContent);
    }
    result.push({
      role: 'assistant',
      content: stripTags(assistantContent),
      quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
    });
  }

  return { messages: result, pipelineUpdate, quickReplies };
}

export function usePipelineChat(
  currentPipeline: PipelineDefinition | null,
  capabilities: Capability[],
  documentType: string,
  documentLanguages?: string[],
): UsePipelineChatResult {
  const [baseMessages, setBaseMessages] = useState<ChatMessage[]>([]);
  const [latestUpdate, setLatestUpdate] = useState<PipelineUpdate | null>(null);
  const eventsRef = useRef<PipelineChatEvent[]>([]);

  const { events, status, error, start } = useSSE<PipelineChatEvent>('/api/pipeline/chat');
  const isStreaming = status === 'connecting' || status === 'streaming';

  eventsRef.current = events;

  const { messages, pipelineUpdate } = buildMessages(baseMessages, events);

  // Track latest pipeline update (persists across messages)
  const effectiveUpdate = pipelineUpdate ?? latestUpdate;
  if (pipelineUpdate && pipelineUpdate !== latestUpdate) {
    // Will be set via the effect below
  }

  const sendMessage = useCallback(
    (message: string) => {
      if (!currentPipeline) return;

      // Consolidate current events into base before starting new stream
      const currentEvents = eventsRef.current;
      let newBase: ChatMessage[];
      if (currentEvents.length > 0) {
        const { messages: consolidated } = buildMessages(baseMessages, currentEvents);
        newBase = consolidated.map((m) =>
          m.quickReplies ? { ...m, quickReplies: undefined } : m,
        );
      } else {
        newBase = baseMessages.map((m) =>
          m.quickReplies ? { ...m, quickReplies: undefined } : m,
        );
      }

      // Save any pipeline update from the previous exchange
      if (pipelineUpdate) {
        setLatestUpdate(pipelineUpdate);
      }

      newBase = [...newBase, { role: 'user' as const, content: message }];
      setBaseMessages(newBase);

      const history = newBase
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      start({
        message,
        history,
        currentPipeline,
        capabilities,
        documentType,
        documentLanguages,
      });
    },
    [currentPipeline, capabilities, documentType, documentLanguages, baseMessages, pipelineUpdate, start],
  );

  const addInitialMessage = useCallback((msg: ChatMessage) => {
    setBaseMessages((prev) => {
      // Only add if no messages exist yet
      if (prev.length > 0) return prev;
      return [msg];
    });
  }, []);

  return {
    messages,
    isStreaming,
    error,
    pipelineUpdate: effectiveUpdate,
    sendMessage,
    addInitialMessage,
  };
}
