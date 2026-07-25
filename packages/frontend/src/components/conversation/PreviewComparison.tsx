import { useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Tabs from '@cloudscape-design/components/tabs';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Button from '@cloudscape-design/components/button';
import Table from '@cloudscape-design/components/table';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import type { PreviewResponse } from '../../hooks/usePreview';
import { CAPABILITY_INFO } from '@idp/shared';
import ExtractionView from '../common/ExtractionView';
import { token } from '../../theme/tokens';

/**
 * One metric as a label/value row. Values are tabular-numeric so digits line up
 * vertically across cards, which is what makes a side-by-side comparison
 * scannable rather than something you have to read twice.
 */
function MetricRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: 'success';
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: token.textSecondary }}>{label}</span>
      <strong
        style={{
          color: emphasis === 'success' ? token.textSuccess : token.text,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </strong>
    </div>
  );
}

/**
 * One capability's extracted value, as a string ExtractionView can render.
 *
 * A capability's `data` is already HTML, CSV, JSON or text depending on the
 * capability's default format, so a string passes through untouched and anything
 * structured is pretty-printed rather than stringified onto one line.
 */
function formatCapabilityData(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

interface PreviewComparisonProps {
  preview: PreviewResponse;
  selectedMethod: string;
  onMethodSelect: (method: string) => void;
  onBuildPipeline: () => void;
  /** True while more method results are still streaming in. */
  isStreaming?: boolean;
}

export default function PreviewComparison({
  preview,
  selectedMethod,
  onMethodSelect,
  onBuildPipeline,
  isStreaming = false,
}: PreviewComparisonProps) {
  /*
   * The output panel shows the SELECTED method, not an independently-toggled one.
   *
   * `showRaw` used to be its own piece of state, so the panel and the selection drifted
   * apart: you could have GPT-5.6 Luna selected while the panel was headed
   * "Opus 4.7 — extracted output". The card you picked and the output you were reading
   * were different models, which makes the comparison actively misleading — you would
   * judge one model's extraction and then build a pipeline with another.
   *
   * Now the panel is derived from `selectedMethod`, and the per-card control only
   * expands/collapses it. Selecting a card therefore switches the output to that card.
   */
  const completedResults = preview.results.filter((r) => r.status === 'complete');
  const selectedName = preview.results.find((m) => m.method === selectedMethod)?.shortName;
  const shownResult = completedResults.find((r) => r.method === selectedMethod) ?? null;

  /*
   * Which capability's output is on screen.
   *
   * The panel used to dump every capability's result into one blob, so with
   * table_extraction AND bounding_box requested you could not tell which one you were
   * looking at — the header said "extracted output" and the body began
   * "table_extraction: format: html..." only if you happened to notice. Capabilities
   * are separate answers and get separate tabs.
   */
  const [activeCapability, setActiveCapability] = useState<string | null>(null);
  const shownCapabilities = shownResult ? Object.keys(shownResult.results) : [];
  const activeCap = activeCapability && shownCapabilities.includes(activeCapability)
    ? activeCapability
    : shownCapabilities[0] ?? null;

  return (
    <Container
      header={
        <Header
          variant="h2"
          counter={`(${completedResults.length}${isStreaming ? ` of ${preview.methods.length}` : ''})`}
          description={
            isStreaming
              ? 'Results are still arriving — methods appear here as each one finishes. You can select one already.'
              : 'Select a method to build your pipeline with — its extracted output appears below. Confidence is self-reported by each model, so judge the extraction itself.'
          }
          actions={
            // Label states the target instead of "selected method": the button used
            // to read "Build Pipeline with selected method" while disabled, which
            // described the empty state as if it were a choice.
            <Button variant="primary" onClick={onBuildPipeline} disabled={!selectedMethod}>
              {selectedName ? `Build pipeline with ${selectedName}` : 'Select a method below'}
            </Button>
          }
        >
          Method comparison
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/* Per-capability comparison table */}
        {completedResults.length > 1 && (
          <Table
            columnDefinitions={[
              {
                id: 'capability',
                header: 'Capability',
                cell: (item) => {
                  const info = CAPABILITY_INFO[item.capability as keyof typeof CAPABILITY_INFO];
                  return <Box variant="strong">{info?.name ?? item.capability}</Box>;
                },
                width: 180,
              },
              /*
                One column per method, and the SELECTED one is marked.
                
                Without this the table was a wall of percentages with no indication of
                which method you had chosen — you could read "Bounding Box 0%" without
                realising it was the column you were about to build a pipeline with.
                The header is also a button, because this table is where the per-capability
                evidence lives, so it should be possible to choose from here rather than
                having to scroll to the cards and match names up.
              */
              ...completedResults.map((r) => {
                const isSel = r.method === selectedMethod;
                return {
                  id: r.method,
                  header: (
                    <button
                      type="button"
                      onClick={() => onMethodSelect(r.method)}
                      title={isSel ? `${r.shortName} is selected` : `Select ${r.shortName}`}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        font: 'inherit',
                        color: isSel ? token.link : 'inherit',
                        fontWeight: isSel ? 700 : 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {isSel && <span aria-hidden="true">✓</span>}
                      {r.shortName}
                    </button>
                  ) as unknown as string,
                  cell: (item: { capability: string; [key: string]: unknown }) => {
                    const capResult = r.results[item.capability];
                    const content = !capResult
                      ? <Box color="text-body-secondary">-</Box>
                      : (
                        <StatusIndicator type={capResult.confidence > 0.7 ? 'success' : capResult.confidence > 0.4 ? 'warning' : 'error'}>
                          {Math.round(capResult.confidence * 100)}%
                        </StatusIndicator>
                      );
                    return (
                      <div
                        style={{
                          fontSize: '12px',
                          // Tint the whole selected column so the eye can follow it down
                          // the rows without re-reading the header each time.
                          background: isSel ? token.surfaceSelected : undefined,
                          fontWeight: isSel ? 600 : undefined,
                          margin: '-4px -8px',
                          padding: '4px 8px',
                        }}
                      >
                        {content}
                      </div>
                    );
                  },
                };
              }),
            ]}
            items={preview.capabilities.map((cap) => ({ capability: cap }))}
            trackBy="capability"
            variant="embedded"
            stripedRows
          />
        )}

        {/*
          Side-by-side metrics.

          Uses a CSS grid rather than <ColumnLayout columns={completedResults.length}>:
          Cloudscape only supports 1-4 columns, and preview routinely completes 19+
          methods, so passing the array length produced an out-of-range value. auto-fill
          also reflows instead of forcing 19 unreadable slivers onto one row.
        */}
        <div
          role="radiogroup"
          aria-label="Choose a method to build your pipeline with"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 12,
          }}
        >
          {completedResults.map((r) => {
            const isSelected = r.method === selectedMethod;
            return (
              /*
                The card IS the chooser.

                A separate RadioGroup above this grid listed the same methods with
                the same metrics, so every method appeared twice and the cards —
                which carry the numbers you actually compare — were the half you
                could not click. Selecting happens where the evidence is.

                role="radio" + tabIndex + key handling rather than a styled <input>:
                the whole card is the hit target, and arrow/space/enter still work,
                so this stays keyboard- and screen-reader-navigable.
              */
              <div
                key={r.method}
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected || (!selectedMethod && r === completedResults[0]) ? 0 : -1}
                onClick={() => onMethodSelect(r.method)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onMethodSelect(r.method);
                    return;
                  }
                  // Arrow keys move between options, as a native radio group does.
                  // Without this the grid announces itself as a radiogroup but only
                  // responds to Tab, which is the wrong contract for the role.
                  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
                    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
                    : 0;
                  if (step === 0) return;
                  e.preventDefault();
                  const i = completedResults.findIndex((c) => c.method === r.method);
                  // Wrap, so the group is traversable from either end.
                  const next = completedResults[(i + step + completedResults.length) % completedResults.length];
                  if (next) {
                    onMethodSelect(next.method);
                    // Move focus with the selection; otherwise focus stays on a card
                    // that is no longer checked and tabIndex sends the next Tab
                    // out of the group.
                    const el = e.currentTarget.parentElement?.children[
                      completedResults.indexOf(next)
                    ] as HTMLElement | undefined;
                    el?.focus();
                  }
                }}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  cursor: 'pointer',
                  // Keep the box the same size whether or not it is selected —
                  // a 1px→2px border swap used to nudge every neighbouring card.
                  border: `2px solid ${isSelected ? token.borderSelected : 'transparent'}`,
                  outline: isSelected ? 'none' : `1px solid ${token.border}`,
                  outlineOffset: -1,
                  background: isSelected ? token.surfaceSelected : token.surface,
                }}
              >
                <SpaceBetween size="xs">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Box variant="strong">{r.shortName}</Box>
                    {/*
                      An explicit marker, because a border-and-tint alone reads as
                      "hovered" rather than "chosen" — and it is the only cue that
                      survives for a user who cannot distinguish the tint.
                    */}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {/*
                        Truncation must be visible on the CARD, not only once the output
                        is open: a fragment scores a normal-looking confidence and a fast
                        latency, so on the grid it reads as one of the better results.
                      */}
                      {r.truncated && (
                        <StatusIndicator type="warning">Cut off</StatusIndicator>
                      )}
                      {isSelected ? (
                        <StatusIndicator type="success">Selected</StatusIndicator>
                      ) : (
                        <span style={{ fontSize: 12, color: token.textSecondary }}>Select</span>
                      )}
                    </span>
                  </div>

                  {/*
                    Metrics as key/value rows. These were hardcoded '#5f6b7a' text
                    on a '#fff' card, i.e. invisible in dark mode.
                  */}
                  <div style={{ fontSize: 13, display: 'grid', gap: 2 }}>
                    <MetricRow
                      label="Est. cost"
                      value={r.estimatedCost != null ? `$${r.estimatedCost.toFixed(4)}` : 'N/A'}
                      emphasis="success"
                    />
                    <MetricRow label="Latency" value={`${(r.latencyMs / 1000).toFixed(1)}s`} />
                    <MetricRow
                      label="Capabilities"
                      value={`${Object.keys(r.results).length}/${preview.capabilities.length}`}
                    />
                    {r.confidence != null && (
                      <MetricRow label="Confidence (self-reported)" value={`${Math.round(r.confidence * 100)}%`} />
                    )}
                    {r.ocrConfidence != null && (
                      <MetricRow label="OCR confidence (measured)" value={`${Math.round(r.ocrConfidence * 100)}%`} />
                    )}
                  </div>
                </SpaceBetween>
              </div>
            );
          })}
        </div>

        {/*
          Output for the SELECTED method, one capability at a time.

          Always rendered (not conditional on a separate toggle) so the panel and the
          highlighted card can never disagree about which model you are looking at.
        */}
        {shownResult && (
          <div className="idp-stream-in">
            <ExpandableSection
              variant="container"
              defaultExpanded
              headerText={`${shownResult.shortName} — extracted output`}
              headerDescription={
                shownCapabilities.length > 1
                  ? `${shownCapabilities.length} capabilities extracted. Pick one below; switch to Source for the verbatim response.`
                  : "Rendered from the model's response. Switch to Source to see it verbatim."
              }
            >
              {shownResult.truncated && (
                <Box padding={{ bottom: 's' }}>
                  <Alert type="warning" header="This output is incomplete">
                    {shownResult.shortName} stopped at its output-token limit, so the
                    response was cut off mid-value — what you see below is a fragment,
                    not the whole document. The confidence figure describes the part that
                    was written, not the part that is missing. Run this method from the
                    Pipeline step, which uses the full model budget instead of the
                    smaller preview cap.
                  </Alert>
                </Box>
              )}
              {shownCapabilities.length > 1 ? (
                <Tabs
                  activeTabId={activeCap ?? undefined}
                  onChange={({ detail }) => setActiveCapability(detail.activeTabId)}
                  tabs={shownCapabilities.map((cap) => {
                    const info = CAPABILITY_INFO[cap as keyof typeof CAPABILITY_INFO];
                    const capResult = shownResult.results[cap];
                    return {
                      id: cap,
                      // Name + confidence per tab: with two capabilities the useful
                      // question is "which of these did it do well", and that was
                      // unanswerable from one merged blob.
                      label: `${info?.name ?? cap}${
                        capResult?.confidence != null
                          ? ` (${Math.round(capResult.confidence * 100)}%)`
                          : ''
                      }`,
                      content: (
                        <ExtractionView
                          data={formatCapabilityData(capResult?.data)}
                          maxHeight={480}
                        />
                      ),
                    };
                  })}
                />
              ) : (
                <ExtractionView
                  data={
                    activeCap
                      ? formatCapabilityData(shownResult.results[activeCap]?.data)
                      : shownResult.rawOutput || JSON.stringify(shownResult.results, null, 2)
                  }
                  maxHeight={480}
                />
              )}
            </ExpandableSection>
          </div>
        )}
      </SpaceBetween>
    </Container>
  );
}
