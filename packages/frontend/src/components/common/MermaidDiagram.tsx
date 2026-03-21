import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: { useMaxWidth: true, htmlLabels: true },
});

interface MermaidDiagramProps {
  chart: string;
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
        const { svg: renderedSvg } = await mermaid.render(id, chart.trim());
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
    <div
      ref={containerRef}
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ overflow: 'auto', maxHeight: '500px', textAlign: 'center' }}
    />
  );
}
