import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import type { CostProjection, ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';

interface ArchDiagramProps {
  text: string;
  diagram: string | null;
  costProjection: CostProjection | null;
}

export default function ArchDiagram({ text, diagram, costProjection }: ArchDiagramProps) {
  return (
    <SpaceBetween size="l">
      {/* Architecture Recommendation */}
      <Container
        header={<Header variant="h2">Architecture Recommendation</Header>}
      >
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', fontSize: '14px' }}>
          {text || (
            <Box textAlign="center" color="text-body-secondary" padding="l">
              Generating architecture recommendation...
            </Box>
          )}
        </div>
      </Container>

      {/* Architecture Diagram */}
      {diagram && (
        <Container
          header={<Header variant="h2">Architecture Diagram</Header>}
        >
          <pre
            style={{
              overflow: 'auto',
              maxHeight: '500px',
              padding: '16px',
              backgroundColor: '#0f1b2a',
              color: '#d1d5db',
              borderRadius: '8px',
              fontSize: '13px',
              lineHeight: '1.5',
              margin: 0,
            }}
          >
            <code>{diagram}</code>
          </pre>
        </Container>
      )}

      {/* Cost Projection */}
      {costProjection && (
        <Container
          header={
            <Header
              variant="h2"
              description={`Projected for ${costProjection.scale} scale: ${costProjection.docsPerMonth.toLocaleString()} documents/month`}
            >
              Cost Projection
            </Header>
          }
        >
          <ColumnLayout columns={1}>
            <Table
              columnDefinitions={[
                {
                  id: 'method',
                  header: 'Processing Method',
                  cell: (item: { method: ProcessingMethod; monthlyCost: number }) => (
                    <Box fontWeight="bold">
                      {METHOD_INFO[item.method]?.name ?? item.method}
                    </Box>
                  ),
                  width: 250,
                },
                {
                  id: 'monthly',
                  header: 'Monthly Cost',
                  cell: (item: { method: ProcessingMethod; monthlyCost: number }) =>
                    `$${item.monthlyCost.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`,
                },
                {
                  id: 'annual',
                  header: 'Annual Cost',
                  cell: (item: { method: ProcessingMethod; monthlyCost: number }) =>
                    `$${(item.monthlyCost * 12).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`,
                },
              ]}
              items={costProjection.methods}
              sortingDisabled
              variant="embedded"
            />
          </ColumnLayout>
        </Container>
      )}
    </SpaceBetween>
  );
}
