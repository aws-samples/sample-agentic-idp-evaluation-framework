import type { ReactNode } from 'react';

interface ResultBlockProps {
  children: ReactNode;
  /** Max height before the block scrolls. Defaults to 400px. */
  maxHeight?: number | string;
}

/**
 * Monospace block for raw extraction output.
 *
 * Replaces inline `<pre>` styles that hardcoded `background: #f2f3f3` and no
 * text color — in dark mode that rendered light-grey text on a light-grey panel,
 * making results effectively unreadable. Uses Cloudscape design tokens so it
 * follows the active theme, with the previous colors as literal fallbacks.
 */
export default function ResultBlock({ children, maxHeight = 400 }: ResultBlockProps) {
  return (
    <pre
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 13,
        lineHeight: 1.5,
        maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
        overflow: 'auto',
        background: 'var(--color-background-code-editor-status-bar, #f2f3f3)',
        color: 'var(--color-text-body-default, #16191f)',
        border: '1px solid var(--color-border-divider-default, #e9ebed)',
        padding: 12,
        borderRadius: 8,
        margin: 0,
      }}
    >
      {children}
    </pre>
  );
}
