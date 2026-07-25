import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript';

/**
 * Generated architecture diagrams failed to render on a whole family of shapes an LLM
 * produces constantly. Measured against the real parser (Chromium + mermaid@11 via
 * `node scripts/mermaid-probe.mjs`), **12 of 26 realistic cases were unrenderable**:
 * unquoted parens in every node shape, a ```mermaid fence, a prose preamble, a subgraph
 * title with a paren, `end` used as a node id, and nested brackets. Each showed the user
 * "Diagram render failed" with raw source dumped below it.
 *
 * Two lessons are encoded here, both learned the hard way:
 *
 *  1. **The previous version of this file re-implemented the sanitizer inline.** It
 *     passed against its own copy of the logic while the shipped function had a
 *     different, broken implementation — one that mangled *already valid* `A[[Batch]]`
 *     into `A["[Batch"]]`. A test that duplicates its subject verifies nothing, so this
 *     file loads and EXECUTES the real source.
 *  2. Reasoning about a grammar is not evidence. Every case below was confirmed against
 *     the actual parser first; this file is the fast regression net, and
 *     `scripts/mermaid-probe.mjs` is the ground truth it came from. Re-run the probe
 *     when changing the sanitizer — it reports, per case, whether the RAW source parses
 *     and whether the SANITIZED source parses, which is what catches a "fix" that
 *     breaks working input.
 */
const COMPONENT = join(
  import.meta.dirname, '..', '..', '..', 'frontend',
  'src', 'components', 'common', 'MermaidDiagram.tsx',
);

const source = readFileSync(COMPONENT, 'utf-8');

/**
 * Load the REAL sanitizer out of the component and evaluate it.
 *
 * Mermaid itself needs a DOM and importing the component would drag in React, but
 * `sanitizeMermaid` is deliberately pure string-to-string, so the block from `SHAPES`
 * to `let counter` runs standalone once compiled.
 *
 * Compiled with the actual TypeScript transpiler rather than regex-stripped: hand-rolled
 * annotation removal mangled `const NEEDS_QUOTING = /[()[\]{}/:&<>#;]/` (the `/:` inside
 * the character class looks like a type annotation) and left `const SHAPES: Array =`
 * behind. Both produced a syntax error that had nothing to do with the code under test.
 */
function loadSanitizer(): (chart: string) => string {
  const start = source.indexOf('const SHAPES');
  const end = source.indexOf('let counter = 0;');
  expect(start, 'SHAPES table not found — did the sanitizer move?').toBeGreaterThan(-1);
  expect(end, 'counter marker not found — did the sanitizer move?').toBeGreaterThan(start);

  const ts = source.slice(start, end).replace(/export function/g, 'function');
  const { outputText } = transpileModule(ts, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  });

  return new Function(`${outputText}; return sanitizeMermaid;`)() as (chart: string) => string;
}

const sanitizeMermaid = loadSanitizer();

describe('sanitizeMermaid repairs what a model actually writes', () => {
  it('strips a code fence the tags already made redundant', () => {
    // Mermaid only inspects the first non-empty line, so one stray fence loses the
    // entire diagram to "No diagram type detected".
    expect(sanitizeMermaid('```mermaid\ngraph TD\n  A[Upload] --> B[S3]\n```'))
      .toBe('graph TD\n  A[Upload] --> B[S3]');
    expect(sanitizeMermaid('```\ngraph TD\n  A[Upload]\n```')).toBe('graph TD\n  A[Upload]');
  });

  it('drops prose before the diagram declaration', () => {
    expect(sanitizeMermaid('Here is the diagram:\n\ngraph TD\n  A[Upload] --> B[S3]'))
      .toBe('graph TD\n  A[Upload] --> B[S3]');
  });

  /*
   * Parentheses are the single most common failure, because the model is describing AWS
   * services and prices and "Textract (OCR)" is the natural phrasing. Previously only
   * the rectangle form was repaired; the other five shapes still hard-failed.
   */
  it.each([
    ['rectangle', 'graph TD\n  A[Textract (OCR)] --> B[C]', 'A["Textract (OCR)"]'],
    ['rounded', 'graph TD\n  A(Textract (OCR)) --> B[C]', 'A("Textract (OCR)")'],
    ['stadium', 'graph TD\n  A([Textract (OCR)]) --> B[C]', 'A(["Textract (OCR)"])'],
    ['rhombus', 'graph TD\n  A{Confidence (high)?} --> B[C]', 'A{"Confidence (high)?"}'],
    ['subroutine', 'graph TD\n  A[[Batch (async)]] --> B[C]', 'A[["Batch (async)"]]'],
    ['cylinder', 'graph TD\n  A[(DynamoDB (results))] --> B[C]', 'A[("DynamoDB (results)")]'],
  ])('quotes a parenthesised label in a %s node', (_shape, input, expected) => {
    expect(sanitizeMermaid(input)).toContain(expected);
  });

  it('quotes the other characters that are syntax elsewhere in the grammar', () => {
    // `:` starts a `:::` class assignment and `&` joins multiple nodes on one edge.
    // Both parse inside a plain rectangle, but quoting them is lossless insurance.
    expect(sanitizeMermaid('graph TD\n  A[Step 1: Upload] --> B[S3]')).toContain('A["Step 1: Upload"]');
    expect(sanitizeMermaid('graph TD\n  A[Extract & Redact] --> B[Out]')).toContain('A["Extract & Redact"]');
  });

  it('does NOT quote a bare slash, so <br/> keeps working', () => {
    /*
     * A slash needs no repair — measured. This assertion exists because quoting it
     * would silently disable `<br/>`, the one way to get a line break in a label:
     * `A["Textract<br/>OCR"]` renders the tag as literal text. A "safe" over-broad
     * character class is how that regression got written in the first place.
     */
    expect(sanitizeMermaid('graph TD\n  A[BDA/LLM] --> B[Out]')).toBe('graph TD\n  A[BDA/LLM] --> B[Out]');
    expect(sanitizeMermaid('graph TD\n  A[$0.0015/page] --> B[Out]')).toBe('graph TD\n  A[$0.0015/page] --> B[Out]');
  });

  it('handles a label containing a nested bracket pair', () => {
    // Scanning to the FIRST closing bracket cut the label short and produced
    // `A["Bedrock [Converse"]]`, which still failed to parse.
    expect(sanitizeMermaid('graph TD\n  A[Bedrock [Converse]] --> B[Done]'))
      .toContain('A["Bedrock [Converse]"]');
  });

  it('quotes a subgraph title containing syntax characters', () => {
    expect(sanitizeMermaid('graph TD\n  subgraph Ingest (S3)\n    A[Upload]\n  end'))
      .toContain('subgraph "Ingest (S3)"');
  });

  it('renames `end` used as a node id', () => {
    // `end` closes a subgraph, so `A --> end` is a parse error with no escape hatch.
    expect(sanitizeMermaid('graph TD\n  A[Upload] --> end')).toBe('graph TD\n  A[Upload] --> end_');
  });

  /*
   * The other half of the contract, and the half that regressed: a diagram that ALREADY
   * parses must come back byte-identical. The earlier sanitizer broke valid subroutine
   * nodes, turning a working diagram into an error message — invisible to a test that
   * only checked the repair cases.
   */
  it.each([
    ['plain', 'graph TD\n  A[Upload] --> B[Extract]'],
    ['subroutine', 'graph TD\n  A[[Batch]] --> B[Done]'],
    ['cylinder', 'graph TD\n  A[(Database)] --> B[Done]'],
    ['stadium', 'graph TD\n  A([Start]) --> B[Done]'],
    ['already-quoted', 'graph TD\n  A["Textract (OCR)"] --> B[Claude]'],
    ['class-def', 'graph TD\n  A[Upload]:::hot --> B[Done]\n  classDef hot fill:#f96'],
    ['semicolons', 'graph TD;\n  A[Upload]-->B[Extract];'],
    ['br-tag', 'graph TD\n  A[Textract<br/>OCR] --> B[Claude]'],
    ['percent', 'graph TD\n  A[98% confidence] --> B[Done]'],
    ['comma', 'graph TD\n  A[Sonnet 4.6, Haiku 4.5] --> B[Done]'],
  ])('leaves valid %s source untouched', (_name, chart) => {
    expect(sanitizeMermaid(chart)).toBe(chart.trim());
  });

  it('never re-quotes an already-quoted label', () => {
    // A second `"` would terminate the string early — worse than the original problem.
    const out = sanitizeMermaid('graph TD\n  A["S3: uploads"] --> B[Lambda (proc)]');
    expect(out).toContain('A["S3: uploads"]');
    expect(out).not.toContain('""');
  });

  it('orders the shape table longest-delimiter-first', () => {
    /*
     * Load-bearing invariant: if `[` were tried before `[[`, the inner bracket of a
     * subroutine node would be taken as the opener. That exact ordering bug shipped.
     */
    const table = source.slice(source.indexOf('const SHAPES'), source.indexOf('NEEDS_QUOTING'));
    expect(table.indexOf("['['"), 'the [[ shape must be listed before [')
      .toBeGreaterThan(table.indexOf("['[['"));
    expect(table.indexOf("['('"), 'the ([ shape must be listed before (')
      .toBeGreaterThan(table.indexOf("['(['"));
  });

  it('is the function the component actually renders with', () => {
    // The repair is useless if render() is called with the raw chart.
    expect(source).toContain('mermaid.render(id, sanitizeMermaid(chart))');
  });
});
