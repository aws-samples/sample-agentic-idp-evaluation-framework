import type { ReactNode } from 'react';
import { token } from '../../theme/tokens';

interface ResultBlockProps {
  children: ReactNode;
  /** Max height before the block scrolls. Defaults to 400px. */
  maxHeight?: number | string;
}

/**
 * Monospace block for raw extraction output.
 *
 * Replaces inline `<pre>` styles that hardcoded `background: #f2f3f3` with no
 * text colour — in dark mode that rendered light-grey text on a light-grey panel,
 * making results effectively unreadable.
 *
 * Note the colours come from the design-token module, not from hand-written
 * `var(--color-…, #fallback)` strings: Cloudscape hashes its custom-property
 * names, so a hand-written variable never resolves and always uses the literal
 * fallback — which left this component light in dark mode even after the first
 * attempt to fix it. See theme/tokens.ts.
 */
export default function ResultBlock({ children, maxHeight = 400 }: ResultBlockProps) {
  return (
    <pre
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: token.fontMono,
        fontSize: 13,
        lineHeight: 1.5,
        maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
        overflow: 'auto',
        background: token.surfaceMuted,
        color: token.text,
        border: `1px solid ${token.border}`,
        padding: 12,
        borderRadius: 8,
        margin: 0,
      }}
    >
      {children}
    </pre>
  );
}
