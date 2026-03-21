import { useState, useEffect, useCallback } from 'react';
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
import { authedFetch } from '../services/api';

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

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [dateRange, setDateRange] = useState<DateRangePickerProps.Value | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await authedFetch('/api/admin/stats');
      if (!res.ok) {
        if (res.status === 403) throw new Error('Admin access required');
        throw new Error(`Failed (${res.status})`);
      }
      const data = await res.json();
      setStats(data);
      setActivity(data.recentActivity);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const fetchFiltered = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (userFilter) params.set('userId', userFilter);
      if (dateRange && dateRange.type === 'absolute') {
        params.set('startDate', dateRange.startDate);
        if (dateRange.endDate) params.set('endDate', dateRange.endDate);
      }
      params.set('limit', '200');
      const res = await authedFetch(`/api/admin/activity?${params}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setActivity(data.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [userFilter, dateRange]);

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
            <Button onClick={fetchFiltered} loading={loading}>Search</Button>
          </ColumnLayout>
        </Container>

        {/* Activity Table */}
        <Table
          header={<Header variant="h2" counter={`(${activity.length})`}>Activity Log</Header>}
          loading={loading}
          loadingText="Loading activity..."
          items={activity}
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
                const d = item.details;
                if (d.message) return String(d.message).substring(0, 80);
                if (d.capabilities) return `${(d.capabilities as string[]).length} capabilities`;
                if (d.fileSize) return `${Math.round((d.fileSize as number) / 1024)}KB, ${d.pageCount} pages`;
                return JSON.stringify(d).substring(0, 80);
              },
            },
          ]}
          sortingDisabled={false}
          variant="embedded"
          stripedRows
          stickyHeader
        />

        {loading && !stats && (
          <Box textAlign="center" padding="xxl"><Spinner size="large" /></Box>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
