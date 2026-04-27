import { useState, useRef, useEffect, useMemo } from 'react';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { marked } from 'marked';
import type { ChatMessage } from '../../hooks/useConversation';
import SafeHtml from '../common/SafeHtml';

// Configure marked for safe inline rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSendMessage: (message: string) => void;
  hideQuickReplies?: boolean;
  title?: string;
  placeholder?: string;
}

export default function ChatPanel({ messages, isStreaming, error, onSendMessage, hideQuickReplies, title, placeholder }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const userScrolledUp = useRef(false);

  // Track user scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      userScrolledUp.current = !isNearBottom;
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Only auto-scroll if user hasn't scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !userScrolledUp.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSendMessage(trimmed);
    setInput('');
  };

  return (
    <Container
      fitHeight
      header={
        <Box variant="h3" padding={{ top: 'xs', bottom: 'xs' }}>
          {title ?? 'Document Analysis Chat'}
        </Box>
      }
      footer={
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <Input
              value={input}
              onChange={({ detail }) => setInput(detail.value)}
              onKeyDown={({ detail }) => {
                if (detail.key === 'Enter') handleSend();
              }}
              placeholder={isStreaming ? 'Waiting for response...' : (placeholder ?? 'Type your answer or click an option above...')}
              disabled={isStreaming}
            />
          </div>
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            iconName="send"
          >
            Send
          </Button>
        </div>
      }
    >
      <div ref={scrollRef} style={{ maxHeight: 'calc(100vh - 380px)', minHeight: '300px', overflowY: 'auto', padding: '4px 0' }}>
        <SpaceBetween size="m">
          {messages.length === 0 && !error && (
            <Box textAlign="center" padding="l">
              <Spinner size="large" />
              <Box padding={{ top: 's' }} color="text-body-secondary">
                Analyzing your document...
              </Box>
            </Box>
          )}
          {error && (
            <Box textAlign="center" padding="l" color="text-status-error">
              <Box variant="p" fontWeight="bold">Analysis failed</Box>
              <Box padding={{ top: 'xs' }}>{error}</Box>
              <Box padding={{ top: 's' }}>
                <Button variant="normal" onClick={() => onSendMessage('__init__')}>
                  Retry
                </Button>
              </Box>
            </Box>
          )}
          {messages.map((msg, idx) => (
            <div key={idx}>
              <MessageBubble message={msg} />
              {msg.quickReplies && msg.quickReplies.length > 0 && !isStreaming && !hideQuickReplies && (
                <QuickReplies
                  options={msg.quickReplies}
                  onSelect={onSendMessage}
                />
              )}
            </div>
          ))}
          {isStreaming && messages.length > 0 && messages[messages.length - 1]?.role !== 'assistant' && (
            <Box padding={{ left: 's' }}>
              <Spinner size="normal" /> Thinking...
            </Box>
          )}
        </SpaceBetween>
      </div>
    </Container>
  );
}

function QuickReplies({
  options,
  onSelect,
}: {
  options: string[];
  onSelect: (text: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        padding: '10px 4px 4px 4px',
      }}
    >
      {options.map((opt, i) => (
        <button
          key={i}
          onClick={() => onSelect(opt)}
          style={{
            padding: '8px 16px',
            borderRadius: '20px',
            border: '1px solid #0972d3',
            backgroundColor: '#ffffff',
            color: '#0972d3',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#0972d3';
            e.currentTarget.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#ffffff';
            e.currentTarget.style.color = '#0972d3';
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  const htmlContent = useMemo(() => {
    if (isUser) return null;
    // Strip any residual tags and parse markdown; <SafeHtml> sanitizes on render.
    const clean = message.content
      .replace(/<options>[\s\S]*?<\/options>/g, '')
      .replace(/<recommendation>[\s\S]*?<\/recommendation>/g, '')
      .replace(/<(?:options|recommendation)[^>]*$/g, '')
      .trim();
    return marked.parse(clean) as string;
  }, [message.content, isUser]);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        padding: '0 4px',
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '10px 14px',
          borderRadius: '12px',
          backgroundColor: isUser ? '#0972d3' : '#f2f3f3',
          color: isUser ? '#ffffff' : '#000716',
          fontSize: '14px',
          lineHeight: '1.6',
        }}
      >
        {message.toolEvents && message.toolEvents.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            {message.toolEvents.map((tool, i) => (
              <div key={i} style={{ fontSize: '12px', opacity: 0.85, marginBottom: '2px' }}>
                <StatusIndicator
                  type={tool.status === 'complete' ? 'success' : 'in-progress'}
                >
                  {tool.status === 'complete' ? `Used: ${tool.name}` : `Analyzing: ${tool.name}...`}
                </StatusIndicator>
              </div>
            ))}
          </div>
        )}
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        ) : (
          <SafeHtml className="chat-markdown" profile="markdown" html={htmlContent ?? ''} />
        )}
      </div>
    </div>
  );
}
