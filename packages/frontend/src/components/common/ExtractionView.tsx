import { useMemo, useState } from 'react';
import Box from '@cloudscape-design/components/box';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import SpaceBetween from '@cloudscape-design/components/space-between';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import SafeHtml from './SafeHtml';
import ResultBlock from './ResultBlock';

/**
 * Strip a fenced code block wrapper from model output.
 *
 * Models frequently return ```yaml / ```json / ```html fences even when told not
 * to. The old viewer printed the fence verbatim, so a table extraction rendered
 * as a wall of "```yaml / table_extraction: / data: "<table> / <thead>..." —
 * unreadable, and it looked like the extraction had failed when it had not.
 */
function stripFence(raw: string): string {
  const fenced = raw.match(/^\s*```[a-zA-Z]*\s*\n([\s\S]*?)```\s*$/);
  return (fenced ? fenced[1] : raw).trim();
}

/** Does this string look like an HTML table/fragment we can render directly? */
function looksLikeHtml(text: string): boolean {
  return /<\s*(table|thead|tbody|tr|td|th|ul|ol|p|div|h[1-6])\b/i.test(text);
}

/** Pretty-print JSON when the payload is JSON-shaped, else return it unchanged. */
function prettyJson(text: string): string | null {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

type View = 'rendered' | 'source';

interface ExtractionViewProps {
  /** The extracted value: an object, an HTML/CSV/text string, anything. */
  data: unknown;
  /** Declared format from the adapter ('html' | 'csv' | 'json' | 'text'). */
  format?: string;
  /** Height cap for the scroll area. */
  maxHeight?: number;
}

/**
 * Displays one extracted capability result.
 *
 * Extraction output is the whole point of the comparison, so it has to be
 * READABLE first and inspectable second. This renders the natural form of the
 * payload — a real table for HTML tables, aligned columns for CSV, pretty-printed
 * JSON for objects — and keeps the exact source one click away for verification,
 * since a rendered table can hide whether the model invented a cell.
 */
export default function ExtractionView({ data, format, maxHeight = 420 }: ExtractionViewProps) {
  const [view, setView] = useState<View>('rendered');

  const { source, kind } = useMemo(() => {
    const raw = typeof data === 'string' ? stripFence(data) : JSON.stringify(data, null, 2);
    if (format === 'html' || looksLikeHtml(raw)) return { source: raw, kind: 'html' as const };
    const json = prettyJson(raw);
    if (json) return { source: json, kind: 'json' as const };
    if (format === 'csv' || (raw.includes(',') && raw.includes('\n'))) {
      return { source: raw, kind: 'csv' as const };
    }
    return { source: raw, kind: 'text' as const };
  }, [data, format]);

  if (data == null || source.length === 0) {
    return <Box color="text-body-secondary" fontSize="body-s">No data extracted</Box>;
  }

  // Nothing gained by offering a "rendered" view of plain text or JSON — the
  // source IS the readable form. Only HTML and CSV have two useful views.
  const hasRendered = kind === 'html' || kind === 'csv';
  const showSource = !hasRendered || view === 'source';

  return (
    <SpaceBetween size="xs">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        {hasRendered ? (
          <SegmentedControl
            selectedId={view}
            onChange={({ detail }) => setView(detail.selectedId as View)}
            label="Result view"
            options={[
              { id: 'rendered', text: kind === 'html' ? 'Table' : 'Columns' },
              { id: 'source', text: 'Source' },
            ]}
          />
        ) : (
          <Box fontSize="body-s" color="text-body-secondary">
            {kind === 'json' ? 'JSON' : 'Text'}
          </Box>
        )}
        <CopyToClipboard
          copyButtonAriaLabel="Copy extracted result"
          copySuccessText="Copied"
          copyErrorText="Failed to copy"
          textToCopy={source}
          variant="icon"
        />
      </div>

      {showSource ? (
        <ResultBlock maxHeight={maxHeight}>{source}</ResultBlock>
      ) : kind === 'html' ? (
        <div style={{ maxHeight, overflow: 'auto' }}>
          <SafeHtml html={source} profile="table" className="idp-extracted-table" />
        </div>
      ) : (
        <CsvTable source={source} maxHeight={maxHeight} />
      )}
    </SpaceBetween>
  );
}

/**
 * CSV as an actual grid.
 *
 * Deliberately a hand-rolled split rather than a CSV library: this is display of
 * model output, not ingestion, so a quoted-comma edge case degrades to one wrong
 * column boundary — and the Source view always shows the exact text.
 */
function CsvTable({ source, maxHeight }: { source: string; maxHeight: number }) {
  const rows = useMemo(
    () => source.split('\n').filter((l) => l.trim().length > 0).map((l) => l.split(',')),
    [source],
  );
  if (rows.length === 0) return null;
  const [header, ...body] = rows;

  return (
    <div style={{ maxHeight, overflow: 'auto' }}>
      <table className="idp-extracted-table">
        <thead>
          <tr>{header.map((cell, i) => <th key={i}>{cell.trim()}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>{row.map((cell, c) => <td key={c}>{cell.trim()}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
