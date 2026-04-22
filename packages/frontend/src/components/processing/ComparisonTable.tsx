import Table from '@cloudscape-design/components/table';
import Header from '@cloudscape-design/components/header';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import { METHOD_INFO, getMethodFamily } from '@idp/shared';
import type { ComparisonResult, MethodFamily } from '@idp/shared';

interface ComparisonTableProps {
  comparison: ComparisonResult | null;
}

export default function ComparisonTable({ comparison }: ComparisonTableProps) {
  if (!comparison) {
    return (
      <Table
        header={<Header variant="h2">Method Comparison</Header>}
        columnDefinitions={[]}
        items={[]}
        empty={
          <Box textAlign="center" color="text-body-secondary" padding="l">
            Comparison results will appear as methods complete processing.
          </Box>
        }
      />
    );
  }

  const items = comparison.methods;

  // Find best values for highlighting
  const bestLatency = Math.min(...items.map((i) => i.metrics.latencyMs));
  const bestCost = Math.min(...items.map((i) => i.metrics.cost));
  const bestConfidence = Math.max(...items.map((i) => i.metrics.confidence));

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
    <Table
      header={
        <Header
          variant="h2"
          description={comparison.recommendation}
        >
          Method Comparison
        </Header>
      }
      columnDefinitions={[
        {
          id: 'family',
          header: 'Family',
          cell: (item) => {
            const family = getMethodFamily(item.method);
            return <Badge>{familyLabels[family]}</Badge>;
          },
          width: 120,
        },
        {
          id: 'method',
          header: 'Method',
          cell: (item) => (
            <Box fontWeight="bold">{METHOD_INFO[item.method]?.shortName ?? item.method}</Box>
          ),
          width: 150,
        },
        {
          id: 'latency',
          header: 'Latency',
          cell: (item) => (
            <span>
              {(item.metrics.latencyMs / 1000).toFixed(1)}s
              {item.metrics.latencyMs === bestLatency && (
                <>
                  {' '}
                  <Badge color="green">Fastest</Badge>
                </>
              )}
            </span>
          ),
        },
        {
          id: 'cost',
          header: 'Cost',
          cell: (item) => (
            <span>
              ${item.metrics.cost.toFixed(4)}
              {item.metrics.cost === bestCost && (
                <>
                  {' '}
                  <Badge color="green">Cheapest</Badge>
                </>
              )}
            </span>
          ),
        },
        {
          id: 'confidence',
          header: 'Confidence',
          cell: (item) => (
            <span>
              {(item.metrics.confidence * 100).toFixed(0)}%
              {item.metrics.confidence === bestConfidence && (
                <>
                  {' '}
                  <Badge color="green">Best</Badge>
                </>
              )}
            </span>
          ),
        },
        {
          id: 'rank',
          header: 'Overall Rank',
          cell: (item) => {
            const rank = item.rank.overall;
            return (
              <StatusIndicator type={rank === 1 ? 'success' : rank === 2 ? 'warning' : 'info'}>
                #{rank}
              </StatusIndicator>
            );
          },
        },
      ]}
      items={items}
      sortingDisabled
      variant="container"
    />
  );
}
