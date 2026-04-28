import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Badge from '@cloudscape-design/components/badge';
import DateRangePicker from '@cloudscape-design/components/date-range-picker';
import type { DateRangePickerProps } from '@cloudscape-design/components/date-range-picker';
import Input from '@cloudscape-design/components/input';
import Spinner from '@cloudscape-design/components/spinner';
import Alert from '@cloudscape-design/components/alert';
import Tabs from '@cloudscape-design/components/tabs';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import { authedFetch } from '../services/api';

const RecentRunsPage = lazy(() => import('./RecentRunsPage'));

interface ActivityRecord {
  userId: string;
  sk: string;
  type: string;
  timestamp: string;
  documentId?: string;
  fileName?: string;
  s3Uri?: string;
  details?: Record<string, unknown>;
}

interface Stats {
  totalUsers: number;
  totalUploads: number;
  totalConversations: number;
  totalPreviews: number;
  recentActivity: ActivityRecord[];
}

interface AdminPageProps {
  onLoadRun: (runId: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  upload: 'blue',
  conversation_start: 'green',
  conversation_message: 'grey',
  preview_start: 'red',
  preview_complete: 'green',
  pipeline_start: 'red',
  pipeline_complete: 'green',
  architecture_generate: 'red',
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function capabilityLabel(cap: string): string {
  return cap.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build the detail content for a selected activity row */
function ActivityDetail({ item, onSwitchToRuns }: { item: ActivityRecord; onSwitchToRuns?: (runId: string) => void }) {
  const d = item.details ?? {};

  if (item.type === 'upload') {
    return (
      <KeyValuePairs
        columns={3}
        items={[
          { label: 'Document', value: item.fileName ?? '-' },
          { label: 'Document ID', value: item.documentId ?? '-' },
          { label: 'S3 URI', value: item.s3Uri ?? '-' },
          { label: 'File size', value: formatFileSize(d.fileSize as number | undefined) },
          { label: 'Page count', value: d.pageCount != null ? String(d.pageCount) : '-' },
          { label: 'User', value: item.userId },
        ]}
      />
    );
  }

  if (item.type === 'conversation_start' || item.type === 'conversation_message') {
    return (
      <SpaceBetween size="s">
        <KeyValuePairs
          columns={3}
          items={[
            { label: 'Document', value: item.fileName ?? item.documentId ?? '-' },
            { label: 'User', value: item.userId },
            { label: 'Time', value: formatTimestamp(item.timestamp) },
          ]}
        />
        {d.message != null && (
          <div>
            <Box variant="awsui-key-label">Message</Box>
            <Box variant="p">{String(d.message)}</Box>
          </div>
        )}
      </SpaceBetween>
    );
  }

  if (item.type === 'preview_start' || item.type === 'preview_complete') {
    const caps = (d.capabilities ?? []) as string[];
    const methods = (d.methods ?? []) as string[];
    const latencyMs = d.latencyMs as number | undefined;
    const runId = d.runId as string | undefined;
    return (
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={3}
          items={[
            { label: 'Document', value: item.fileName ?? item.documentId ?? '-' },
            { label: 'User', value: item.userId },
            { label: 'Latency', value: latencyMs != null ? (latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`) : '-' },
          ]}
        />
        {caps.length > 0 && (
          <div>
            <Box variant="awsui-key-label">Capabilities ({caps.length})</Box>
            <SpaceBetween direction="horizontal" size="xs">
              {caps.map((c) => <Badge key={c} color="blue">{capabilityLabel(c)}</Badge>)}
            </SpaceBetween>
          </div>
        )}
        {methods.length > 0 && (
          <div>
            <Box variant="awsui-key-label">Methods</Box>
            <SpaceBetween direction="horizontal" size="xs">
              {methods.map((m) => <Badge key={m} color="grey">{m}</Badge>)}
            </SpaceBetween>
          </div>
        )}
        {d.costPerMethod != null && (
          <div>
            <Box variant="awsui-key-label">Cost per method</Box>
            <Box variant="p">
              {Object.entries(d.costPerMethod as Record<string, number>).map(([m, cost]) =>
                `${m}: $${cost.toFixed(4)}`
              ).join(', ')}
            </Box>
          </div>
        )}
        {runId && onSwitchToRuns && (
          <Button variant="normal" onClick={() => onSwitchToRuns(runId)}>
            View full run
          </Button>
        )}
      </SpaceBetween>
    );
  }

  if (item.type === 'pipeline_start' || item.type === 'pipeline_complete') {
    const caps = (d.capabilities ?? []) as string[];
    const methods = (d.methods ?? []) as string[];
    const selectedMethod = d.selectedMethod as string | undefined;
    const pipelineName = d.pipelineName as string | undefined;
    return (
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={3}
          items={[
            { label: 'Document', value: item.fileName ?? item.documentId ?? '-' },
            { label: 'Pipeline', value: pipelineName ?? '-' },
            { label: 'Selected method', value: selectedMethod ?? '-' },
            { label: 'User', value: item.userId },
          ]}
        />
        {caps.length > 0 && (
          <div>
            <Box variant="awsui-key-label">Capabilities ({caps.length})</Box>
            <SpaceBetween direction="horizontal" size="xs">
              {caps.map((c) => <Badge key={c} color="blue">{capabilityLabel(c)}</Badge>)}
            </SpaceBetween>
          </div>
        )}
        {methods.length > 0 && (
          <div>
            <Box variant="awsui-key-label">Methods</Box>
            <SpaceBetween direction="horizontal" size="xs">
              {methods.map((m) => <Badge key={m} color="grey">{m}</Badge>)}
            </SpaceBetween>
          </div>
        )}
      </SpaceBetween>
    );
  }

  if (item.type === 'architecture_generate') {
    const recommendation = d.recommendation as string | undefined;
    return (
      <SpaceBetween size="s">
        <KeyValuePairs
          columns={2}
          items={[
            { label: 'Document', value: item.fileName ?? item.documentId ?? '-' },
            { label: 'User', value: item.userId },
          ]}
        />
        {recommendation && (
          <div>
            <Box variant="awsui-key-label">Recommendation</Box>
            <Box variant="p">
              {recommendation.length > 500 ? recommendation.substring(0, 500) + '...' : recommendation}
            </Box>
          </div>
        )}
      </SpaceBetween>
    );
  }

  // Fallback: show raw details
  return (
    <KeyValuePairs
      columns={3}
      items={[
        { label: 'Document', value: item.fileName ?? item.documentId ?? '-' },
        { label: 'User', value: item.userId },
        { label: 'Details', value: item.details ? JSON.stringify(item.details, null, 2).substring(0, 300) : '-' },
      ]}
    />
  );
}

export default function AdminPage({ onLoadRun }: AdminPageProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [dateRange, setDateRange] = useState<DateRangePickerProps.Value | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivityRecord | null>(null);
  const [activeTab, setActiveTab] = useState('runs');
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);

  const fetchStats = useCallback(async () => {
    try {
      const res = await authedFetch('/api/admin/stats');
      if (!res.ok) {
        if (res.status === 403) throw new Error('Admin access required. Your alias is not on the admin list.');
        throw new Error(`Failed (${res.status})`);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        throw new Error('Server returned a non-JSON response. This can happen if CloudFront cache is stale — try again in a few minutes.');
      }
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const fetchActivity = useCallback(async (append = false) => {
    setActivityLoading(true);
    try {
      const params = new URLSearchParams();
      if (userFilter) params.set('userId', userFilter);
      if (dateRange && dateRange.type === 'absolute') {
        params.set('startDate', dateRange.startDate);
        if (dateRange.endDate) params.set('endDate', dateRange.endDate);
      }
      params.set('limit', '100');
      if (append && nextToken) params.set('nextToken', nextToken);
      const res = await authedFetch(`/api/admin/activity?${params}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json() as { records: ActivityRecord[]; nextToken?: string };
      if (append) {
        setActivity(prev => [...prev, ...data.records]);
      } else {
        setActivity(data.records);
      }
      setNextToken(data.nextToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActivityLoading(false);
    }
  }, [userFilter, dateRange, nextToken]);

  const fetchFiltered = useCallback(() => {
    setNextToken(undefined);
    fetchActivity(false);
  }, [fetchActivity]);

  // Auto-fetch activity when switching to the Activity Log tab
  useEffect(() => {
    if (activeTab === 'activity' && activity.length === 0 && !activityLoading) {
      fetchActivity(false);
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Switch to the Runs tab and optionally trigger a load */
  const handleSwitchToRuns = useCallback((runId: string) => {
    setActiveTab('runs');
    onLoadRun(runId);
  }, [onLoadRun]);

  if (error) {
    return (
      <ContentLayout header={<Header variant="h1">Admin</Header>}>
        <Alert type="error" header="Access denied">{error}</Alert>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout header={
      <Header variant="h1" actions={
        <Button iconName="refresh" onClick={() => { fetchStats(); }} loading={loading}>Refresh</Button>
      }>
        Admin Dashboard
      </Header>
    }>
      <SpaceBetween size="l">
        {/* Stats Cards */}
        {stats && (
          <Container header={<Header variant="h2">Usage Summary</Header>}>
            <ColumnLayout columns={4} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">Total Users</Box>
                <Box variant="awsui-value-large">{stats.totalUsers}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Documents Uploaded</Box>
                <Box variant="awsui-value-large">{stats.totalUploads}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Conversations</Box>
                <Box variant="awsui-value-large">{stats.totalConversations}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Previews Run</Box>
                <Box variant="awsui-value-large">{stats.totalPreviews}</Box>
              </div>
            </ColumnLayout>
          </Container>
        )}

        {/* Tabbed lower section */}
        <Tabs
          activeTabId={activeTab}
          onChange={({ detail }) => setActiveTab(detail.activeTabId)}
          tabs={[
            {
              id: 'runs',
              label: 'Evaluation Runs',
              content: (
                <Suspense fallback={<Box textAlign="center" padding="xxl"><Spinner size="large" /></Box>}>
                  <RecentRunsPage onLoadRun={onLoadRun} isAdmin embedded />
                </Suspense>
              ),
            },
            {
              id: 'activity',
              label: 'Activity Log',
              content: (
                <SpaceBetween size="l">
                  {/* Filters */}
                  <Container header={<Header variant="h2">Filters</Header>}>
                    <ColumnLayout columns={3}>
                      <Input
                        placeholder="Filter by user alias"
                        value={userFilter}
                        onChange={({ detail }) => setUserFilter(detail.value)}
                      />
                      <DateRangePicker
                        value={dateRange}
                        onChange={({ detail }) => setDateRange(detail.value)}
                        placeholder="Filter by date range"
                        relativeOptions={[
                          { key: 'last-hour', amount: 1, unit: 'hour', type: 'relative' },
                          { key: 'last-day', amount: 1, unit: 'day', type: 'relative' },
                          { key: 'last-week', amount: 1, unit: 'week', type: 'relative' },
                        ]}
                        isValidRange={() => ({ valid: true })}
                        i18nStrings={{
                          todayAriaLabel: 'Today',
                          nextMonthAriaLabel: 'Next month',
                          previousMonthAriaLabel: 'Previous month',
                          customRelativeRangeDurationLabel: 'Duration',
                          customRelativeRangeDurationPlaceholder: 'Enter duration',
                          customRelativeRangeOptionLabel: 'Custom range',
                          customRelativeRangeOptionDescription: 'Set a custom range in the past',
                          customRelativeRangeUnitLabel: 'Unit of time',
                          formatRelativeRange: (e) => `Last ${e.amount} ${e.unit}(s)`,
                          formatUnit: (unit, value) => (value === 1 ? unit : `${unit}s`),
                          relativeModeTitle: 'Relative range',
                          absoluteModeTitle: 'Absolute range',
                          relativeRangeSelectionHeading: 'Choose a range',
                          startDateLabel: 'Start date',
                          endDateLabel: 'End date',
                          startTimeLabel: 'Start time',
                          endTimeLabel: 'End time',
                          clearButtonLabel: 'Clear',
                          cancelButtonLabel: 'Cancel',
                          applyButtonLabel: 'Apply',
                        }}
                      />
                      <Button onClick={fetchFiltered} loading={activityLoading}>Search</Button>
                    </ColumnLayout>
                  </Container>

                  {/* Activity Table */}
                  <Table
                    header={
                      <Header variant="h2" counter={`(${activity.length}${nextToken ? '+' : ''})`}
                        actions={<Button iconName="refresh" onClick={() => fetchActivity(false)} loading={activityLoading}>Refresh</Button>}
                      >
                        Activity Log
                      </Header>
                    }
                    loading={activityLoading && activity.length === 0}
                    loadingText="Loading activity..."
                    items={activity}
                    selectionType="single"
                    selectedItems={selectedActivity ? [selectedActivity] : []}
                    onSelectionChange={({ detail }) => {
                      const item = detail.selectedItems[0] ?? null;
                      setSelectedActivity(item === selectedActivity ? null : item);
                    }}
                    trackBy="sk"
                    empty={<Box textAlign="center" padding="l">No activity recorded yet.</Box>}
                    columnDefinitions={[
                      {
                        id: 'timestamp',
                        header: 'Time',
                        cell: (item) => formatTimestamp(item.timestamp),
                        sortingField: 'timestamp',
                        width: 180,
                      },
                      {
                        id: 'user',
                        header: 'User',
                        cell: (item) => item.userId,
                        width: 120,
                      },
                      {
                        id: 'type',
                        header: 'Action',
                        cell: (item) => (
                          <Badge color={TYPE_COLORS[item.type] as any ?? 'grey'}>
                            {item.type.replace(/_/g, ' ')}
                          </Badge>
                        ),
                        width: 180,
                      },
                      {
                        id: 'fileName',
                        header: 'Document',
                        cell: (item) => item.fileName ?? item.documentId?.substring(0, 8) ?? '-',
                      },
                      {
                        id: 'details',
                        header: 'Details',
                        cell: (item) => {
                          if (!item.details) return '-';
                          const dd = item.details;
                          if (dd.message) return String(dd.message).substring(0, 80);
                          if (dd.capabilities) return `${(dd.capabilities as string[]).length} capabilities`;
                          if (dd.fileSize) return `${Math.round((dd.fileSize as number) / 1024)}KB, ${dd.pageCount} pages`;
                          return JSON.stringify(dd).substring(0, 80);
                        },
                      },
                    ]}
                    sortingDisabled={false}
                    variant="embedded"
                    stripedRows
                    stickyHeader
                  />

                  {/* Load more button */}
                  {nextToken && (
                    <Box textAlign="center" padding="s">
                      <Button onClick={() => fetchActivity(true)} loading={activityLoading} variant="normal">
                        Load more activity...
                      </Button>
                    </Box>
                  )}

                  {/* Activity detail panel */}
                  {selectedActivity && (
                    <Container
                      header={
                        <Header variant="h2">
                          {selectedActivity.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          {' — '}
                          {selectedActivity.fileName ?? selectedActivity.documentId?.substring(0, 8) ?? 'Details'}
                        </Header>
                      }
                    >
                      <ActivityDetail item={selectedActivity} onSwitchToRuns={handleSwitchToRuns} />
                    </Container>
                  )}
                </SpaceBetween>
              ),
            },
          ]}
        />

        {loading && !stats && (
          <Box textAlign="center" padding="xxl"><Spinner size="large" /></Box>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
