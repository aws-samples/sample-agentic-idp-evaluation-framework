import { useState, useCallback, useEffect, useRef } from 'react';
import type { ConversationEvent, CapabilityRecommendation } from '@idp/shared';
import { useSSE } from './useSSE';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: { name: string; status: 'running' | 'complete'; result?: unknown }[];
  quickReplies?: string[];
}

export interface UseConversationResult {
  messages: ChatMessage[];
  recommendations: CapabilityRecommendation[] | null;
  ambiguity: AmbiguityScores | null;
  isStreaming: boolean;
  error: string | null;
  sendMessage: (message: string) => void;
}

export interface AmbiguityScores {
  scores: Record<string, number>;
  overall: number;
  passed: boolean;
}

/** Strip control tags from display text */
function stripTags(text: string): string {
  return text
    .replace(/<options>[\s\S]*?<\/options>/g, '')
    .replace(/<recommendation>[\s\S]*?<\/recommendation>/g, '')
    .replace(/<ambiguity>[\s\S]*?<\/ambiguity>/g, '')
    .replace(/<(?:options|recommendation|ambiguity)[^>]*$/g, '')
    .trim();
}

/** Extract <ambiguity>{...}</ambiguity> from text */
function extractAmbiguity(text: string): AmbiguityScores | null {
  const match = text.match(/<ambiguity>([\s\S]*?)<\/ambiguity>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as AmbiguityScores;
  } catch {
    return null;
  }
}

/** Extract <options>[...]</options> from text and return parsed options */
function extractQuickReplies(text: string): string[] {
  const match = text.match(/<options>([\s\S]*?)<\/options>/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]) as string[];
  } catch {
    return [];
  }
}

/**
 * Build messages array from events (pure function, no mutation).
 * StrictMode-safe: called from scratch each time.
 */
function buildMessages(
  baseMessages: ChatMessage[],
  events: ConversationEvent[],
): { messages: ChatMessage[]; recommendations: CapabilityRecommendation[] | null; ambiguity: AmbiguityScores | null } {
  const result: ChatMessage[] = [...baseMessages];
  let recommendations: CapabilityRecommendation[] | null = null;
  let ambiguity: AmbiguityScores | null = null;
  let assistantContent = '';
  let toolEvents: { name: string; status: 'running' | 'complete'; result?: unknown }[] = [];
  let hasAssistant = false;

  for (const event of events) {
    switch (event.type) {
      case 'text':
        hasAssistant = true;
        assistantContent += event.data;
        break;

      case 'tool_use':
        hasAssistant = true;
        toolEvents = [...toolEvents, {
          name: (event.data as { name: string }).name,
          status: 'running',
        }];
        break;

      case 'tool_result': {
        const toolName = (event.data as { name: string }).name;
        const toolResult = (event.data as { result: unknown }).result;
        toolEvents = toolEvents.map((t) =>
          t.name === toolName && t.status === 'running'
            ? { ...t, status: 'complete' as const, result: toolResult }
            : t,
        );
        break;
      }

      case 'recommendation':
        recommendations = (event.data as { capabilities: CapabilityRecommendation[] }).capabilities;
        break;

      case 'done':
        break;
    }
  }

  if (hasAssistant) {
    const isDone = events.some((e) => e.type === 'done');
    const quickReplies = isDone ? extractQuickReplies(assistantContent) : [];
    if (isDone) {
      ambiguity = extractAmbiguity(assistantContent);
    }

    result.push({
      role: 'assistant',
      content: stripTags(assistantContent),
      toolEvents: toolEvents.length > 0 ? toolEvents : undefined,
      quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
    });
  }

  return { messages: result, recommendations, ambiguity };
}

export function useConversation(
  documentId: string | null,
  s3Uri?: string,
): UseConversationResult {
  const [baseMessages, setBaseMessages] = useState<ChatMessage[]>([]);
  const [recommendations, setRecommendations] = useState<CapabilityRecommendation[] | null>(null);
  const [ambiguity, setAmbiguity] = useState<AmbiguityScores | null>(null);
  const initDone = useRef(false);
  const eventsRef = useRef<ConversationEvent[]>([]);

  const { events, status, error, start } = useSSE<ConversationEvent>('/api/conversation');

  const isStreaming = status === 'connecting' || status === 'streaming';

  // Keep a ref to events for use in sendMessage without stale closures
  eventsRef.current = events;

  // Build messages from base + current events (pure, no mutation)
  const { messages, recommendations: eventRecs, ambiguity: eventAmbiguity } = buildMessages(baseMessages, events);

  // Update recommendations and ambiguity when events produce them
  useEffect(() => {
    if (eventRecs) setRecommendations(eventRecs);
  }, [eventRecs]);

  useEffect(() => {
    if (eventAmbiguity) setAmbiguity(eventAmbiguity);
  }, [eventAmbiguity]);

  // NO auto-consolidation on 'done' — that caused duplicates!
  // Instead, consolidate in sendMessage before starting a new stream.

  const sendMessage = useCallback(
    (message: string, isHidden = false) => {
      if (!documentId) return;

      // Consolidate current events into base BEFORE starting new stream.
      // start() will clear events, so after this buildMessages(newBase, []) = newBase.
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

      if (!isHidden) {
        newBase = [...newBase, { role: 'user' as const, content: message }];
      }

      setBaseMessages(newBase);

      const history = newBase
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      start({
        documentId,
        s3Uri,
        message,
        history: isHidden ? [] : history,
      });
    },
    [documentId, s3Uri, baseMessages, start],
  );

  // Auto-start conversation when document is loaded
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    if (documentId && !initDone.current) {
      initDone.current = true;
      startRef.current({
        documentId,
        s3Uri,
        message: '__init__',
        history: [],
      });
    }
    return () => {
      initDone.current = false;
    };
  }, [documentId, s3Uri]);

  return { messages, recommendations, ambiguity, isStreaming, error, sendMessage };
}
