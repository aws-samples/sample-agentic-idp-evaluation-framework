import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import SafeHtml from './SafeHtml';

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
 * Repair the two things an LLM reliably gets wrong about Mermaid, both verified
 * against the real parser:
 *
 *  1. It wraps the diagram in a ```mermaid fence even when the surrounding tags
 *     already delimit it. Mermaid then reports "No diagram type detected", because
 *     the first line is the fence rather than `graph TD`.
 *  2. It writes unquoted parentheses in node labels — `A[Textract (OCR)]` — which is
 *     a hard "Parse error on line 2"; Mermaid treats `(` as shape syntax.
 *
 * Both produced a diagram-render-failed message with the raw source dumped below it,
 * which reads as a broken feature rather than a formatting slip. Repairing is right
 * here rather than only in the prompt: the model will occasionally get it wrong
 * however firmly it is asked, and this is deterministic and lossless.
 */
export function sanitizeMermaid(chart: string): string {
  let out = chart.trim();

  // 1. Strip an enclosing code fence (```mermaid … ``` or bare ``` … ```).
  const fenced = out.match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n?```$/i);
  if (fenced) out = fenced[1].trim();

  /*
   * 2. Quote labels containing characters Mermaid treats as syntax.
   *
   * Matched on `[`…`]` non-greedily up to the FIRST `]`. Anchoring on the square
   * brackets matters: a character-class of opening delimiters let a `(` inside the
   * label be taken as the opener, which turned `A[Textract (OCR)]` into
   * `A["Textract (OCR")]` — still broken, just differently.
   *
   * A label already containing a `"` is left alone: the quote would terminate the
   * string early, so there is no safe automatic repair.
   */
  out = out.replace(/\[([^\]\n"]*)\]/g, (match, label: string) => {
    if (!/[()/:&]/.test(label)) return match;
    return `["${label.trim()}"]`;
  });

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
    return (
      <div>
        <pre style={{
          background: '#f8f9fa', padding: '16px', borderRadius: '8px',
          fontSize: '13px', overflow: 'auto', maxHeight: '400px',
        }}>
          <code>{chart}</code>
        </pre>
        <div style={{ color: '#d13212', fontSize: '12px', marginTop: '4px' }}>
          Diagram render failed: {error}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ overflow: 'auto', maxHeight: '500px', textAlign: 'center' }}>
      <SafeHtml html={svg} profile="svg" />
    </div>
  );
}
