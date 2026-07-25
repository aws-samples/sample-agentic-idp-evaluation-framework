import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import SafeHtml from './SafeHtml';
import { token } from '../../theme/tokens';

// `securityLevel: 'strict'` makes Mermaid itself escape user-supplied labels,
// then we additionally run the rendered SVG through DOMPurify (via <SafeHtml>)
// before injecting it into the DOM.
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  flowchart: { useMaxWidth: true, htmlLabels: false },
});

interface MermaidDiagramProps {
  chart: string;
}

/**
 * Node shapes, longest delimiter first.
 *
 * Order is load-bearing. `[[` must be tried before `[`, or the inner bracket of a
 * subroutine node `A[[Batch (async)]]` is taken as the opener and the label is quoted
 * in the wrong place — which produced `A["[Batch (async)"]]`, breaking a diagram that
 * had merely been unrenderable before. Verified with scripts/mermaid-probe.mjs.
 */
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['[[', ']]'], // subroutine
  ['[(', ')]'], // cylinder / database
  ['([', '])'], // stadium
  ['((', '))'], // circle
  ['{{', '}}'], // hexagon
  ['[', ']'],   // rectangle
  ['(', ')'],   // rounded
  ['{', '}'],   // rhombus / decision
];

/**
 * What actually breaks an unquoted label. Every entry was measured with the probe.
 *
 * Deliberately narrow, because quoting is not free: `A[Textract<br/>OCR]` parses fine
 * and the `<br/>` is a line break the author meant to keep, so quoting it changes the
 * rendering while pretending to be a repair. `<`, `>`, `%`, `,`, `;` and a bare `/` are
 * all excluded for that reason — the probe confirms they parse as-is.
 *
 * Brackets and braces genuinely terminate the label. `:` and `&` parse inside a
 * rectangle but are syntax elsewhere in the grammar (`:::` class assignment, `&`
 * multi-node edges), and quoting those is lossless.
 */
const NEEDS_QUOTING = /[()[\]{}:&]/;

/**
 * Repair what an LLM reliably gets wrong about Mermaid.
 *
 * Every rule here was verified against the real parser (Chromium + mermaid@11) with
 * `node scripts/mermaid-probe.mjs`, not reasoned about — an earlier version of this
 * function was written from the grammar and shipped a fresh corruption that "looked
 * right". The probe reports, per case, whether the RAW source parses and whether the
 * SANITIZED source parses, so a repair that breaks valid input shows up immediately.
 *
 * Repairing here rather than only in the prompt: the model will occasionally get it
 * wrong however firmly it is asked, and these transforms are deterministic.
 */
export function sanitizeMermaid(chart: string): string {
  let out = chart.trim();

  // 1. Strip an enclosing code fence (```mermaid … ``` or bare ``` … ```).
  const fenced = out.match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n?```$/i);
  if (fenced) out = fenced[1].trim();

  /*
   * 2. Drop any prose before the diagram declaration.
   *
   * "Here is the diagram:\n\ngraph TD…" fails with "No diagram type detected" because
   * Mermaid only inspects the first non-empty line. Anything before the first
   * recognised diagram keyword is commentary, so discarding it is lossless.
   */
  const decl = out.match(
    /^[\s\S]*?^(\s*(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|C4Context)\b)/m,
  );
  if (decl && decl.index !== undefined) {
    const start = out.indexOf(decl[1]);
    if (start > 0) out = out.slice(start).trim();
  }

  // 3. Quote node labels containing characters Mermaid treats as syntax.
  out = quoteNodeLabels(out);

  /*
   * 4. Quote subgraph titles containing syntax characters.
   *
   * `subgraph Ingest (S3)` is a parse error; `subgraph "Ingest (S3)"` renders. Mermaid
   * also accepts an id form (`subgraph id [title]`), which the label pass above covers,
   * so only the bare-title form is handled here.
   */
  out = out.replace(/^(\s*subgraph\s+)([^\n"[]+)$/gm, (match, prefix: string, title: string) => {
    const trimmed = title.trim();
    if (!NEEDS_QUOTING.test(trimmed)) return match;
    return `${prefix}"${trimmed}"`;
  });

  /*
   * 5. Rename reserved-word node ids.
   *
   * `end` terminates a subgraph, so `A[Upload] --> end` is a parse error. Mermaid has
   * no escape for it; renaming to `end_` keeps the edge and the layout, and the label
   * a reader sees is unaffected because a bare id renders as its own text.
   */
  out = out.replace(/(-->|---|-\.->|==>)(\s*)\bend\b(?!\s*\[)/g, '$1$2end_');
  out = out.replace(/^(\s*)\bend\b(\s*)(-->|---|-\.->|==>)/gm, '$1end_$2$3');

  return out;
}

/**
 * Where a node's label ends, given the delimiter pair that opened it.
 *
 * Not simply the first `close`: a label may itself contain a bracket or paren, as in
 * `A[Bedrock [Converse]]` or `A(Textract (OCR))`. Taking the first match cut the label
 * short and emitted `A["Bedrock [Converse"]]`, which still failed to parse. So the
 * scan tracks depth over the *single-character* forms of the delimiters and returns the
 * position where the label is balanced — while stopping at end-of-line, because an
 * unbalanced label is a typo rather than a nested one and must be left untouched.
 *
 * Returns -1 when no balanced end exists on this line.
 */
function findLabelEnd(src: string, from: number, open: string, close: string): number {
  const openCh = open.at(-1) as string;
  const closeCh = close[0];
  let depth = 0;

  for (let j = from; j < src.length; j += 1) {
    const ch = src[j];
    if (ch === '\n') return -1;
    // A quoted span is opaque: brackets inside it are text, not structure.
    if (ch === '"') {
      const endQuote = src.indexOf('"', j + 1);
      if (endQuote === -1 || src.slice(j, endQuote).includes('\n')) return -1;
      j = endQuote;
      continue;
    }
    if (ch === openCh) {
      depth += 1;
      continue;
    }
    if (ch === closeCh) {
      if (depth === 0 && src.startsWith(close, j)) return j;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * Walk the source and quote each node label that needs it.
 *
 * A scanner rather than a regex: the delimiters nest (`[(`, `[[`, `([`) and the closing
 * token has to match the opener that was actually used. A single regex either misses
 * the multi-character shapes or matches their inner bracket — both were shipped bugs.
 */
function quoteNodeLabels(src: string): string {
  let out = '';
  let i = 0;

  while (i < src.length) {
    const shape = SHAPES.find((s) => src.startsWith(s[0], i));
    // Only treat a delimiter as a node opener when it follows an id character;
    // otherwise `-->` targets and edge labels get mangled.
    const prev = out.at(-1) ?? '';
    if (!shape || !/[\wÀ-￿)\]}]/.test(prev)) {
      out += src[i];
      i += 1;
      continue;
    }

    const [open, close] = shape;
    const bodyStart = i + open.length;
    const bodyEnd = findLabelEnd(src, bodyStart, open, close);
    if (bodyEnd === -1) {
      out += src[i];
      i += 1;
      continue;
    }

    const label = src.slice(bodyStart, bodyEnd);
    // A label spanning a newline is not a label; leave the source alone.
    if (label.includes('\n')) {
      out += src[i];
      i += 1;
      continue;
    }

    /*
     * Already quoted, or nothing to fix: emit verbatim. An existing `"` is left alone
     * because re-quoting would terminate the string early, and Mermaid already accepts
     * a quoted label containing anything.
     */
    if (label.includes('"') || !NEEDS_QUOTING.test(label)) {
      out += open + label + close;
    } else {
      out += `${open}"${label.trim()}"${close}`;
    }
    i = bodyEnd + close.length;
  }

  return out;
}

let counter = 0;

export default function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chart.trim()) return;

    const id = `mermaid-${++counter}`;
    (async () => {
      try {
        const { svg: renderedSvg } = await mermaid.render(id, sanitizeMermaid(chart));
        setSvg(renderedSvg);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
        setSvg('');
        // Clean up failed render element
        const el = document.getElementById(id);
        el?.remove();
      }
    })();
  }, [chart]);

  if (error) {
    /*
     * Explain, then show. The previous version dumped the source in a hardcoded
     * light-grey block with the error underneath in red and no way to get the text out
     * — unreadable in dark mode, and the user could not act on it. The source is worth
     * keeping visible (it is the only copy, and someone debugging a prompt wants it),
     * but it needs a sentence saying what to do and a way to copy it.
     */
    return (
      <Alert
        type="warning"
        header="This diagram could not be drawn"
        action={<Button iconName="copy" onClick={() => navigator.clipboard?.writeText(chart)}>Copy source</Button>}
      >
        <SpaceBetween size="s">
          <Box variant="p">
            The generated diagram source is not valid Mermaid, so it is shown as text
            below. Everything else on this page is unaffected — regenerating usually
            produces a diagram that renders.
          </Box>
          <Box variant="code" fontSize="body-s" color="text-status-inactive">{error}</Box>
          <pre
            style={{
              background: token.surfaceMuted, padding: 16, borderRadius: 8,
              fontSize: 13, overflow: 'auto', maxHeight: 400, margin: 0,
            }}
          >
            <code>{chart}</code>
          </pre>
        </SpaceBetween>
      </Alert>
    );
  }

  return (
    <div ref={containerRef} style={{ overflow: 'auto', maxHeight: '500px', textAlign: 'center' }}>
      <SafeHtml html={svg} profile="svg" />
    </div>
  );
}
