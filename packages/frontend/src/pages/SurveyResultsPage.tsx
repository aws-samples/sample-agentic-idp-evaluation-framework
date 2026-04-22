import { useEffect, useState, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Table from '@cloudscape-design/components/table';
import Alert from '@cloudscape-design/components/alert';
import Spinner from '@cloudscape-design/components/spinner';
import type { FeedbackSummary } from '@idp/shared';
import { FEEDBACK_RATING_MAX, FEEDBACK_RATING_STEP } from '@idp/shared';
import { authedFetch } from '../services/api';

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  } catch {
    return ts;
  }
}

function renderStars(rating: number): string {
  const full = Math.floor(rating);
  const half = rating - full >= FEEDBACK_RATING_STEP;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, FEEDBACK_RATING_MAX - full - (half ? 1 : 0)));
}

export default function SurveyResultsPage() {
  const [data, setData] = useState<FeedbackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/admin/feedback');
      if (!res.ok) {
        if (res.status === 403) throw new Error('Admin access required');
        throw new Error(`Failed (${res.status})`);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        throw new Error('Server returned a non-JSON response. CloudFront may be caching stale content.');
      }
      setData(await res.json() as FeedbackSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  if (error) {
    return (
      <ContentLayout header={<Header variant="h1">Survey Results</Header>}>
        <Alert type="error" header="Error">{error}</Alert>
      </ContentLayout>
    );
  }

  const maxBucket = data
    ? Math.max(1, ...Object.values(data.distribution))
    : 1;

  const buckets: string[] = [];
  for (let v = FEEDBACK_RATING_STEP; v <= FEEDBACK_RATING_MAX + 1e-6; v += FEEDBACK_RATING_STEP) {
    buckets.push(v.toFixed(1));
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <Button iconName="refresh" onClick={fetchSummary} loading={loading}>
              Refresh
            </Button>
          }
        >
          Survey Results
        </Header>
      }
    >
      <SpaceBetween size="l">
        {data && (
          <Container header={<Header variant="h2">Summary</Header>}>
            <ColumnLayout columns={3} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">Total submissions</Box>
                <Box variant="awsui-value-large">{data.totalSubmissions}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Average rating</Box>
                <Box variant="awsui-value-large">
                  {data.averageRating !== null ? `${data.averageRating.toFixed(2)} / ${FEEDBACK_RATING_MAX}` : '—'}
                </Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Users with comments</Box>
                <Box variant="awsui-value-large">{data.records.filter((r) => r.comment).length}</Box>
              </div>
            </ColumnLayout>
          </Container>
        )}

        {data && (
          <Container header={<Header variant="h2">Rating distribution</Header>}>
            <SpaceBetween size="xs">
              {buckets.map((bucket) => {
                const count = data.distribution[bucket] ?? 0;
                const pct = (count / maxBucket) * 100;
                return (
                  <div key={bucket} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, fontVariantNumeric: 'tabular-nums', color: '#687078' }}>{bucket}</div>
                    <div style={{ flex: 1, background: '#f4f4f4', height: 18, borderRadius: 2, position: 'relative' }}>
                      <div
                        style={{
                          width: `${pct}%`,
                          background: '#0972d3',
                          height: '100%',
                          borderRadius: 2,
                          transition: 'width 200ms',
                        }}
                      />
                    </div>
                    <div style={{ width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{count}</div>
                  </div>
                );
              })}
            </SpaceBetween>
          </Container>
        )}

        <Table
          header={<Header variant="h2" counter={data ? `(${data.records.length})` : undefined}>Submissions</Header>}
          loading={loading}
          loadingText="Loading feedback..."
          items={data?.records ?? []}
          empty={<Box textAlign="center" padding="l">No feedback submitted yet.</Box>}
          columnDefinitions={[
            {
              id: 'submittedAt',
              header: 'Submitted',
              cell: (r) => formatTimestamp(r.submittedAt),
              width: 200,
            },
            {
              id: 'userId',
              header: 'User',
              cell: (r) => r.userId,
              width: 140,
            },
            {
              id: 'rating',
              header: 'Rating',
              cell: (r) => (
                <span>
                  <span style={{ color: '#0972d3' }}>{r.rating.toFixed(1)}</span>
                  <span style={{ marginLeft: 8, color: '#0972d3' }}>{renderStars(r.rating)}</span>
                </span>
              ),
              width: 160,
            },
            {
              id: 'comment',
              header: 'Comment',
              cell: (r) => r.comment ? r.comment : <span style={{ color: '#687078' }}>—</span>,
            },
          ]}
          variant="embedded"
          stripedRows
          stickyHeader
        />

        {loading && !data && (
          <Box textAlign="center" padding="xxl"><Spinner size="large" /></Box>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
