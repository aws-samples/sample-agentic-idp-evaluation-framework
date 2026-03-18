import { useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Tabs from '@cloudscape-design/components/tabs';
import RadioGroup from '@cloudscape-design/components/radio-group';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Spinner from '@cloudscape-design/components/spinner';
import Button from '@cloudscape-design/components/button';
import type { PreviewResponse, MethodResult } from '../../hooks/usePreview';

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
  const methodInfo = preview.methods;

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Each method processed your document. Compare results and select your preferred method for the pipeline."
          actions={
            <Button variant="primary" onClick={onBuildPipeline} disabled={!selectedMethod}>
              Build Pipeline with {methodInfo.find((m) => m.method === selectedMethod)?.shortName ?? 'selected method'}
            </Button>
          }
        >
          Extraction Preview — Compare Methods
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/* Method Selection */}
        <RadioGroup
          value={selectedMethod}
          onChange={({ detail }) => onMethodSelect(detail.value)}
          items={preview.results.map((r) => {
            const info = methodInfo.find((m) => m.method === r.method);
            const hasError = !!r.error;

            const costStr = r.actualCost
              ? `$${r.actualCost.totalCost.toFixed(6)}`
              : 'N/A';
            const tokenStr = r.tokenUsage
              ? `${r.tokenUsage.inputTokens} in / ${r.tokenUsage.outputTokens} out`
              : '';

            return {
              value: r.method,
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <strong>{info?.shortName ?? r.method}</strong>
                  <span style={{ color: '#037f0c', fontSize: '13px', fontWeight: 600 }}>
                    {costStr}
                  </span>
                  <span style={{ color: '#5f6b7a', fontSize: '12px' }}>
                    {tokenStr}
                  </span>
                  <span style={{ color: '#5f6b7a', fontSize: '13px' }}>
                    {r.latencyMs}ms
                  </span>
                  {hasError ? (
                    <StatusIndicator type="error">Failed</StatusIndicator>
                  ) : (
                    <StatusIndicator type="success">OK</StatusIndicator>
                  )}
                </span>
              ) as unknown as string,
              disabled: hasError,
            };
          })}
        />

        {/* Results Comparison Tabs */}
        <Tabs
          tabs={preview.results
            .filter((r) => !r.error)
            .map((r) => {
              const info = methodInfo.find((m) => m.method === r.method);
              const isSelected = r.method === selectedMethod;

              return {
                id: r.method,
                label: `${info?.shortName ?? r.method}${isSelected ? ' (selected)' : ''}`,
                content: <MethodResultView result={r} />,
              };
            })}
        />

        {/* Side-by-side metrics */}
        <ColumnLayout columns={preview.results.filter((r) => !r.error).length} variant="text-grid">
          {preview.results
            .filter((r) => !r.error)
            .map((r) => {
              const info = methodInfo.find((m) => m.method === r.method);
              const parsed = r.results as Record<string, unknown>;
              const extractions = (parsed?.extractions ?? {}) as Record<string, { found?: boolean }>;
              const found = Object.values(extractions).filter((e) => e?.found).length;
              const total = Object.keys(extractions).length;

              return (
                <div key={r.method} style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: r.method === selectedMethod ? '2px solid #0972d3' : '1px solid #e9ebed',
                  background: r.method === selectedMethod ? '#f0f8ff' : '#fff',
                }}>
                  <Box variant="strong">{info?.shortName}</Box>
                  <div style={{ marginTop: '8px', fontSize: '13px', color: '#5f6b7a' }}>
                    <div>Actual Cost: <strong style={{ color: '#037f0c' }}>
                      {r.actualCost ? `$${r.actualCost.totalCost.toFixed(6)}` : 'N/A'}
                    </strong></div>
                    {r.tokenUsage && (
                      <div>Tokens: <strong>{r.tokenUsage.inputTokens.toLocaleString()} in / {r.tokenUsage.outputTokens.toLocaleString()} out</strong></div>
                    )}
                    <div>Latency: <strong>{r.latencyMs}ms</strong></div>
                    <div>Fields found: <strong>{found}/{total}</strong></div>
                    <div>Confidence: <strong>{
                      typeof parsed?.confidence === 'number'
                        ? `${Math.round((parsed.confidence as number) * 100)}%`
                        : 'N/A'
                    }</strong></div>
                  </div>
                </div>
              );
            })}
        </ColumnLayout>
      </SpaceBetween>
    </Container>
  );
}

function MethodResultView({ result }: { result: MethodResult }) {
  const [showRaw, setShowRaw] = useState(false);
  const parsed = result.results as Record<string, unknown>;
  const extractions = (parsed?.extractions ?? {}) as Record<string, { found?: boolean; data?: unknown; confidence?: number }>;

  return (
    <SpaceBetween size="m">
      {/* Document info */}
      {typeof parsed?.document_type === 'string' && (
        <ColumnLayout columns={3} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">Document Type</Box>
            <Box>{String(parsed.document_type)}</Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Language</Box>
            <Box>{String(parsed.language ?? 'Unknown')}</Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Summary</Box>
            <Box>{String(parsed.summary ?? '')}</Box>
          </div>
        </ColumnLayout>
      )}

      {/* Extraction results per capability */}
      {Object.keys(extractions).length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e9ebed' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontWeight: 600 }}>Capability</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600 }}>Found</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: 600 }}>Confidence</th>
                <th style={{ textAlign: 'left', padding: '8px', fontWeight: 600 }}>Extracted Data</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(extractions).map(([cap, val]) => (
                <tr key={cap} style={{ borderBottom: '1px solid #f2f3f3' }}>
                  <td style={{ padding: '8px', fontWeight: 500 }}>
                    {cap.replace(/_/g, ' ')}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    {val?.found ? (
                      <StatusIndicator type="success">Yes</StatusIndicator>
                    ) : (
                      <StatusIndicator type="stopped">No</StatusIndicator>
                    )}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    {val?.confidence != null ? `${Math.round(val.confidence * 100)}%` : '-'}
                  </td>
                  <td style={{ padding: '8px', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {val?.data != null ? (
                      <code style={{ fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {typeof val.data === 'string' ? val.data : JSON.stringify(val.data, null, 1)}
                      </code>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Raw toggle */}
      <div>
        <Button variant="link" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? 'Hide' : 'Show'} raw response
        </Button>
        {showRaw && (
          <pre style={{
            background: '#f8f8f8',
            padding: '12px',
            borderRadius: '6px',
            fontSize: '12px',
            maxHeight: '300px',
            overflow: 'auto',
            marginTop: '8px',
          }}>
            {result.rawText || JSON.stringify(result.results, null, 2)}
          </pre>
        )}
      </div>
    </SpaceBetween>
  );
}
