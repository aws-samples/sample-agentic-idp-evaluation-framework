import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Diagram rendering failed on two shapes an LLM produces constantly, both verified
 * against the real Mermaid parser:
 *
 *   1. a ```mermaid fence inside the <diagram> tags -> "No diagram type detected"
 *   2. unquoted parentheses in a label, e.g. A[Textract (OCR)] -> hard parse error
 *
 * Either produced "Diagram render failed" with the raw source dumped below it, which
 * reads as a broken feature rather than a formatting slip. Both ends are now fixed:
 * the prompt states the rules, and `sanitizeMermaid` repairs the output anyway
 * because the model will still get it wrong sometimes.
 *
 * The sanitizer logic is re-implemented here from the component source so it can be
 * exercised without a DOM (mermaid itself needs one, and importing the component
 * would drag in React). Asserting the SOURCE still contains the same regex keeps the
 * copy honest.
 */
const COMPONENT = join(
  import.meta.dirname, '..', '..', '..', 'frontend',
  'src', 'components', 'common', 'MermaidDiagram.tsx',
);

function sanitizeMermaid(chart: string): string {
  let out = chart.trim();
  const fenced = out.match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n?```$/i);
  if (fenced) out = fenced[1].trim();
  out = out.replace(/\[([^\]\n"]*)\]/g, (match, label: string) => {
    if (!/[()/:&]/.test(label)) return match;
    return `["${label.trim()}"]`;
  });
  return out;
}

describe('sanitizeMermaid', () => {
  it('strips a code fence the tags already made redundant', () => {
    const out = sanitizeMermaid('```mermaid\ngraph TD\n  A[Upload] --> B[S3]\n```');
    expect(out.startsWith('graph TD')).toBe(true);
    expect(out).not.toMatch(/```/);
  });

  it('quotes labels containing Mermaid syntax characters', () => {
    // The exact case that failed: parentheses in a model name.
    expect(sanitizeMermaid('graph TD\n  A[Textract (OCR)] --> B[Claude]'))
      .toContain('A["Textract (OCR)"]');
    expect(sanitizeMermaid('graph TD\n  A[BDA/LLM] --> B[Out]')).toContain('A["BDA/LLM"]');
    expect(sanitizeMermaid('graph TD\n  A[Step 1: Upload] --> B[S3]'))
      .toContain('A["Step 1: Upload"]');
    expect(sanitizeMermaid('graph TD\n  A[Extract & Redact] --> B[Out]'))
      .toContain('A["Extract & Redact"]');
    expect(sanitizeMermaid('graph TD\n  A[Cost $0.0015/pg] --> B[Out]'))
      .toContain('A["Cost $0.0015/pg"]');
  });

  it('does not misplace the quote when the label itself contains a paren', () => {
    /*
     * The first implementation matched a character class of opening delimiters, so the
     * `(` inside the label was taken as the opener and it emitted
     * A["Textract (OCR")] — still broken, just differently. Anchoring on [ … ] fixed
     * it, and this is the regression that would otherwise be invisible.
     */
    const out = sanitizeMermaid('graph TD\n  A[Textract (OCR)] --> B[Claude]');
    expect(out).not.toContain('(OCR")');
    expect(out).toContain('(OCR)"]');
  });

  it('leaves an already-valid diagram byte-identical', () => {
    // A repair pass that rewrites correct input is a new source of bugs.
    for (const valid of [
      'graph TD\n  A[Upload] --> B[S3]',
      'graph TD\n  A["Textract (OCR)"] --> B["Claude"]',
    ]) {
      expect(sanitizeMermaid(valid)).toBe(valid);
    }
  });

  it('leaves a label containing a double quote alone', () => {
    // Quoting it would terminate the string early; there is no safe auto-repair.
    const input = 'graph TD\n  A[say "hi" (now)] --> B[Out]';
    expect(sanitizeMermaid(input)).toBe(input);
  });

  it('the component still uses this exact logic', () => {
    const src = readFileSync(COMPONENT, 'utf-8');
    expect(src).toContain('export function sanitizeMermaid');
    // Anchored on [ … ], not a delimiter class — see the misplaced-quote test above.
    expect(src).toContain('out.replace(/\\[([^\\]\\n"]*)\\]/g');
    expect(src).toContain('sanitizeMermaid(chart)');
  });
});
