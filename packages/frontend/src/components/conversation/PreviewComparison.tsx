import { useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
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
  const [showRaw, setShowRaw] = useState<string | null>(null);
  const completedResults = preview.results.filter((r) => r.status === 'complete');
  const selectedName = preview.results.find((m) => m.method === selectedMethod)?.shortName;
  const shownResult = completedResults.find((r) => r.method === showRaw) ?? null;

  return (
    <Container
      header={
        <Header
          variant="h2"
          counter={`(${completedResults.length}${isStreaming ? ` of ${preview.methods.length}` : ''})`}
          description={
            isStreaming
              ? 'Results are still arriving — methods appear here as each one finishes. You can select one already.'
              : "Select a card to choose the method to build your pipeline with. Confidence is self-reported by each model, so use 'View output' to judge the extraction yourself."
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
              ...completedResults.map((r) => ({
                id: r.method,
                header: r.shortName,
                cell: (item: { capability: string; [key: string]: unknown }) => {
                  const capResult = r.results[item.capability];
                  if (!capResult) return <Box color="text-body-secondary">-</Box>;
                  return (
                    <div style={{ fontSize: '12px' }}>
                      <StatusIndicator type={capResult.confidence > 0.7 ? 'success' : capResult.confidence > 0.4 ? 'warning' : 'error'}>
                        {Math.round(capResult.confidence * 100)}%
                      </StatusIndicator>
                    </div>
                  );
                },
              })),
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
                    {isSelected ? (
                      <StatusIndicator type="success">Selected</StatusIndicator>
                    ) : (
                      <span style={{ fontSize: 12, color: token.textSecondary }}>Select</span>
                    )}
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

                  {/*
                    Opens the viewer BELOW the grid, not inside this card. Expanding
                    it in place gave a ~240px-wide column to a wide extracted table
                    and stretched one card to several times the height of its
                    neighbours, wrecking the side-by-side comparison the grid exists
                    for.
                  */}
                  {/*
                    stopPropagation: the card itself is now a radio, so without this
                    "View output" would also change the selection — inspecting a
                    method's extraction would silently commit you to it.
                  */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="inline-link"
                      onClick={() => setShowRaw(showRaw === r.method ? null : r.method)}
                      iconName={showRaw === r.method ? 'angle-up' : 'angle-down'}
                    >
                      {showRaw === r.method ? 'Hide output' : 'View output'}
                    </Button>
                  </div>
                </SpaceBetween>
              </div>
            );
          })}
        </div>

        {/* Full-width output viewer for the selected card. */}
        {shownResult && (
          <div className="idp-stream-in">
            <ExpandableSection
              variant="container"
              defaultExpanded
              headerText={`${shownResult.shortName} — extracted output`}
              headerDescription="Rendered from the model's response. Switch to Source to see it verbatim."
            >
              <ExtractionView
                data={shownResult.rawOutput || JSON.stringify(shownResult.results, null, 2)}
                maxHeight={480}
              />
            </ExpandableSection>
          </div>
        )}
      </SpaceBetween>
    </Container>
  );
}
