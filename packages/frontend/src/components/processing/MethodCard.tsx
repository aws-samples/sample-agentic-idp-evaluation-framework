import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Badge from '@cloudscape-design/components/badge';
import { METHOD_INFO, CAPABILITY_INFO, getMethodFamily } from '@idp/shared';
import type { Capability, MethodFamily } from '@idp/shared';
import type { MethodProgress } from '../../hooks/useProcessing';
import StreamingResult from './StreamingResult';

interface MethodCardProps {
  progress: MethodProgress;
  capabilities: Capability[];
}

const STATUS_MAP = {
  pending: 'pending' as const,
  processing: 'in-progress' as const,
  complete: 'success' as const,
  error: 'error' as const,
};

export default function MethodCard({ progress, capabilities }: MethodCardProps) {
  const info = METHOD_INFO[progress.method];
  const family = getMethodFamily(progress.method);

  const familyLabels: Record<MethodFamily, string> = {
    bda: 'BDA',
    'bda-llm': 'BDA+LLM',
    claude: 'Claude',
    nova: 'Nova',
    'textract-llm': 'Textract+LLM',
    embeddings: 'Embeddings',
    guardrails: 'Guardrails',
  };

  return (
    <Container
      header={
        <Header
          variant="h3"
          description={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Badge>{familyLabels[family]}</Badge>
              <span>{info?.description ?? ''}</span>
            </div>
          }
          info={
            <StatusIndicator type={STATUS_MAP[progress.status]}>
              {progress.status === 'pending' && 'Queued'}
              {progress.status === 'processing' && 'Processing'}
              {progress.status === 'complete' && 'Complete'}
              {progress.status === 'error' && 'Failed'}
            </StatusIndicator>
          }
        >
          {info?.name ?? progress.method}
        </Header>
      }
    >
      <SpaceBetween size="m">
        <ProgressBar
          value={progress.overallProgress}
          status={
            progress.status === 'error'
              ? 'error'
              : progress.status === 'complete'
                ? 'success'
                : 'in-progress'
          }
          resultText={
            progress.status === 'complete'
              ? 'Complete'
              : progress.status === 'error'
                ? progress.error ?? 'Error'
                : undefined
          }
          label="Overall progress"
        />

        {progress.result?.metrics && (
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">Latency</Box>
              <Box>{(progress.result.metrics.latencyMs / 1000).toFixed(1)}s</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Cost</Box>
              <Box>${progress.result.metrics.cost.toFixed(4)}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Confidence</Box>
              <Box>
                {progress.result.metrics.confidence
                  ? `${(progress.result.metrics.confidence * 100).toFixed(0)}%`
                  : '-'}
              </Box>
            </div>
          </ColumnLayout>
        )}

        <ExpandableSection headerText="Capability Details" variant="footer">
          <SpaceBetween size="s">
            {capabilities.map((cap) => {
              const capInfo = CAPABILITY_INFO[cap];
              const capProg = progress.capabilityProgress[cap] ?? 0;
              const partial = progress.partialResults[cap];
              return (
                <div key={cap}>
                  <Box variant="awsui-key-label">{capInfo?.name ?? cap}</Box>
                  <ProgressBar
                    value={capProg}
                    status={capProg >= 100 ? 'success' : 'in-progress'}
                  />
                  {partial && <StreamingResult content={partial} format="text" />}
                </div>
              );
            })}
          </SpaceBetween>
        </ExpandableSection>

        {progress.error && (
          <StatusIndicator type="error">{progress.error}</StatusIndicator>
        )}
      </SpaceBetween>
    </Container>
  );
}
