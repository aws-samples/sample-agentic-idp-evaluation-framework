import { useState } from 'react';
import BarChart from '@cloudscape-design/components/bar-chart';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import Box from '@cloudscape-design/components/box';
import { METHOD_INFO, getMethodFamily } from '@idp/shared';
import type { ComparisonResult, MethodFamily } from '@idp/shared';

interface MetricsChartProps {
  comparison: ComparisonResult | null;
}

type MetricView = 'latency' | 'cost' | 'confidence';

export default function MetricsChart({ comparison }: MetricsChartProps) {
  const [view, setView] = useState<MetricView>('latency');

  if (!comparison || comparison.methods.length === 0) {
    return (
      <Container header={<Header variant="h2">Performance Metrics</Header>}>
        <Box textAlign="center" color="text-body-secondary" padding="l">
          Charts will appear as processing methods complete.
        </Box>
      </Container>
    );
  }

  const items = comparison.methods;

  // Color mapping by family
  const familyColors: Record<MethodFamily, string> = {
    bda: '#0972d3',
    claude: '#8b5cf6',
    nova: '#ec7211',
    'textract-llm': '#037f0c',
  };

  // Group by family for multiple series
  const familyGroups: Record<MethodFamily, typeof items> = {
    bda: [],
    claude: [],
    nova: [],
    'textract-llm': [],
  };

  for (const item of items) {
    const family = getMethodFamily(item.method);
    familyGroups[family].push(item);
  }

  interface ChartSeries {
    title: string;
    type: 'bar';
    data: { x: string; y: number }[];
    color?: string;
  }

  const seriesMap: Record<MetricView, ChartSeries[]> = {
    latency: Object.entries(familyGroups)
      .filter(([_, methods]) => methods.length > 0)
      .map(([family, methods]) => ({
        title: family,
        type: 'bar' as const,
        color: familyColors[family as MethodFamily],
        data: methods.map((m) => ({
          x: METHOD_INFO[m.method]?.shortName ?? m.method,
          y: Number((m.metrics.latencyMs / 1000).toFixed(1)),
        })),
      })),
    cost: Object.entries(familyGroups)
      .filter(([_, methods]) => methods.length > 0)
      .map(([family, methods]) => ({
        title: family,
        type: 'bar' as const,
        color: familyColors[family as MethodFamily],
        data: methods.map((m) => ({
          x: METHOD_INFO[m.method]?.shortName ?? m.method,
          y: Number(m.metrics.cost.toFixed(4)),
        })),
      })),
    confidence: Object.entries(familyGroups)
      .filter(([_, methods]) => methods.length > 0)
      .map(([family, methods]) => ({
        title: family,
        type: 'bar' as const,
        color: familyColors[family as MethodFamily],
        data: methods.map((m) => ({
          x: METHOD_INFO[m.method]?.shortName ?? m.method,
          y: Number((m.metrics.confidence * 100).toFixed(0)),
        })),
      })),
  };

  const activeSeries = seriesMap[view];
  const allData = activeSeries.flatMap(s => s.data);

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <SegmentedControl
              selectedId={view}
              onChange={({ detail }) => setView(detail.selectedId as MetricView)}
              options={[
                { id: 'latency', text: 'Latency' },
                { id: 'cost', text: 'Cost' },
                { id: 'confidence', text: 'Confidence' },
              ]}
            />
          }
        >
          Performance Metrics
        </Header>
      }
    >
      <BarChart
        series={activeSeries}
        xDomain={allData.map((d) => d.x)}
        yDomain={[0, Math.max(...allData.map((d) => d.y)) * 1.2]}
        xTitle="Method"
        yTitle={activeSeries[0]?.title || ''}
        height={300}
        hideFilter
      />
    </Container>
  );
}
