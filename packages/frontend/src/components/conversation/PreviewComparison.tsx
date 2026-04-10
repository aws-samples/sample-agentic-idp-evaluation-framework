import { useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Tabs from '@cloudscape-design/components/tabs';
import RadioGroup from '@cloudscape-design/components/radio-group';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Button from '@cloudscape-design/components/button';
import Table from '@cloudscape-design/components/table';
import type { PreviewResponse } from '../../hooks/usePreview';
import { CAPABILITY_INFO } from '@idp/shared';

interface PreviewComparisonProps {
  preview: PreviewResponse;
  selectedMethod: string;
  onMethodSelect: (method: string) => void;
  onBuildPipeline: () => void;
}

export default function PreviewComparison({
  preview,
  selectedMethod,
  onMethodSelect,
  onBuildPipeline,
}: PreviewComparisonProps) {
  const [showRaw, setShowRaw] = useState<string | null>(null);
  const completedResults = preview.results.filter((r) => r.status === 'complete');

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Compare extraction results across methods. Select your preferred method for the pipeline. Confidence scores are self-reported by each model — click 'Show raw' to verify actual output quality."
          actions={
            <Button variant="primary" onClick={onBuildPipeline} disabled={!selectedMethod}>
              Build Pipeline with {preview.results.find((m) => m.method === selectedMethod)?.shortName ?? 'selected method'}
            </Button>
          }
        >
          Method Comparison
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/* Method Selection */}
        <RadioGroup
          value={selectedMethod}
          onChange={({ detail }) => onMethodSelect(detail.value)}
          items={preview.results.map((r) => ({
            value: r.method,
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <strong>{r.shortName}</strong>
                {r.estimatedCost != null && (
                  <span style={{ color: '#037f0c', fontSize: '13px', fontWeight: 600 }}>
                    ~${r.estimatedCost.toFixed(4)}
                  </span>
                )}
                <span style={{ color: '#5f6b7a', fontSize: '13px' }}>{r.latencyMs}ms</span>
                {r.confidence != null && (
                  <span style={{ color: '#5f6b7a', fontSize: '12px' }}>
                    {Math.round(r.confidence * 100)}% avg confidence
                  </span>
                )}
                {r.status === 'error' ? (
                  <StatusIndicator type="error">Failed</StatusIndicator>
                ) : (
                  <StatusIndicator type="success">OK</StatusIndicator>
                )}
              </span>
            ) as unknown as string,
            disabled: r.status === 'error',
          }))}
        />

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
            variant="embedded"
            stripedRows
          />
        )}

        {/* Side-by-side metrics */}
        <ColumnLayout columns={completedResults.length} variant="text-grid">
          {completedResults.map((r) => (
            <div key={r.method} style={{
              padding: '12px',
              borderRadius: '8px',
              border: r.method === selectedMethod ? '2px solid #0972d3' : '1px solid #e9ebed',
              background: r.method === selectedMethod ? '#f0f8ff' : '#fff',
            }}>
              <Box variant="strong">{r.shortName}</Box>
              <div style={{ marginTop: '8px', fontSize: '13px', color: '#5f6b7a' }}>
                <div>Est. Cost: <strong style={{ color: '#037f0c' }}>
                  {r.estimatedCost != null ? `$${r.estimatedCost.toFixed(4)}` : 'N/A'}
                </strong></div>
                <div>Latency: <strong>{r.latencyMs}ms</strong></div>
                <div>Capabilities: <strong>
                  {Object.keys(r.results).length}/{preview.capabilities.length}
                </strong></div>
                {r.confidence != null && (
                  <div>Avg Confidence: <strong>{Math.round(r.confidence * 100)}%</strong></div>
                )}
              </div>
              <div style={{ marginTop: '8px' }}>
                <Button variant="normal" onClick={() => setShowRaw(showRaw === r.method ? null : r.method)} iconName={showRaw === r.method ? 'angle-up' : 'angle-down'}>
                  {showRaw === r.method ? 'Hide raw' : 'Show raw'}
                </Button>
                {showRaw === r.method && (
                  <pre style={{
                    background: '#f8f8f8', padding: '8px', borderRadius: '6px',
                    fontSize: '11px', maxHeight: '200px', overflow: 'auto', marginTop: '4px',
                  }}>
                    {r.rawOutput || JSON.stringify(r.results, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </ColumnLayout>
      </SpaceBetween>
    </Container>
  );
}
