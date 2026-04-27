import Box from '@cloudscape-design/components/box';
import SafeHtml from '../common/SafeHtml';

interface StreamingResultProps {
  content: string;
  format: 'html' | 'csv' | 'json' | 'text' | 'image' | string;
}

export default function StreamingResult({ content, format }: StreamingResultProps) {
  if (!content) return null;

  if (format === 'html') {
    return (
      <SafeHtml
        html={content}
        profile="table"
        style={{
          overflow: 'auto',
          maxHeight: '400px',
          border: '1px solid #e9ebed',
          borderRadius: '8px',
          padding: '12px',
          backgroundColor: '#fafafa',
        }}
      />
    );
  }

  if (format === 'json') {
    let formatted = content;
    try {
      formatted = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      // use raw content
    }
    return (
      <pre
        style={{
          overflow: 'auto',
          maxHeight: '400px',
          border: '1px solid #e9ebed',
          borderRadius: '8px',
          padding: '12px',
          backgroundColor: '#0f1b2a',
          color: '#d1d5db',
          fontSize: '13px',
          lineHeight: '1.5',
          margin: 0,
        }}
      >
        {formatted}
      </pre>
    );
  }

  if (format === 'csv') {
    return (
      <pre
        style={{
          overflow: 'auto',
          maxHeight: '400px',
          border: '1px solid #e9ebed',
          borderRadius: '8px',
          padding: '12px',
          backgroundColor: '#fafafa',
          fontSize: '13px',
          lineHeight: '1.5',
          margin: 0,
        }}
      >
        {content}
      </pre>
    );
  }

  return (
    <Box variant="p" color="text-body-secondary">
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{content}</div>
    </Box>
  );
}
