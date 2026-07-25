import type { CSSProperties } from 'react';
import { token } from '../../../theme/tokens';

/**
 * Shared styling for every pipeline canvas node.
 *
 * The six node components each re-implemented the same card: a hardcoded
 * `background: '#ffffff'`, a status-coloured border from a copy-pasted switch, and
 * `#5f6b7a` label text. In dark mode that meant light text on a white card — the
 * canvas was the last part of the app that ignored the theme — and a change to the
 * card had to be made six times.
 *
 * Status colours stay literal on purpose: green/red/blue carry meaning here and
 * are legible against both surfaces, unlike the card background and label text,
 * which must follow the theme.
 */

export type NodeState = 'idle' | 'active' | 'complete' | 'error';

export const NODE_STATUS_COLORS = {
  active: '#0972d3',
  complete: '#037f0c',
  error: '#d91515',
  idle: '#7d8998',
} as const;

/**
 * Border colour for a node state.
 * @param activeColor Overrides the border while active — method nodes use their
 *   family's brand colour there, which is deliberate identity, not decoration.
 */
export function nodeBorderColor(state: NodeState, activeColor?: string): string {
  switch (state) {
    case 'active': return activeColor ?? NODE_STATUS_COLORS.active;
    case 'complete': return NODE_STATUS_COLORS.complete;
    case 'error': return NODE_STATUS_COLORS.error;
    default: return NODE_STATUS_COLORS.idle;
  }
}

/** The node card itself. Surface and text follow the theme; the border signals state. */
export function nodeCardStyle(
  state: NodeState,
  options: { activeColor?: string; minWidth?: number; maxWidth?: number } = {},
): CSSProperties {
  const { activeColor, minWidth = 180, maxWidth } = options;
  const glow = activeColor ?? NODE_STATUS_COLORS.active;
  return {
    padding: 12,
    borderRadius: 8,
    border: `2px solid ${nodeBorderColor(state, activeColor)}`,
    background: token.surface,
    color: token.text,
    minWidth,
    ...(maxWidth ? { maxWidth } : {}),
    boxShadow: state === 'active'
      ? `0 0 10px ${glow}80`
      : '0 1px 3px rgba(0,0,0,0.18)',
  };
}

/** Secondary label text inside a node (method name, capability list, metrics). */
export const nodeSubtleText: CSSProperties = {
  fontSize: 11,
  color: token.textSecondary,
};

/** Divider between a node's header and its detail rows. */
export const nodeDivider = `1px solid ${token.borderSubtle}`;
