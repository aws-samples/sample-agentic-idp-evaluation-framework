import { useState, useEffect, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Badge from '@cloudscape-design/components/badge';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Alert from '@cloudscape-design/components/alert';
import Toggle from '@cloudscape-design/components/toggle';
import Container from '@cloudscape-design/components/container';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import { authedFetch } from '../services/api';

interface RunSummary {
  runId: string;
  userId: string;
  documentId: string;
  documentName: string;
  capabilities: string[];
  methods: string[];
  timestamp: string;
  status: 'complete' | 'error';
  source: 'preview' | 'pipeline';
  fileType?: string;
  fileSize?: number;
  pageCount?: number;
  documentLanguages?: string[];
}

interface RunDetail {
  runId: string;
  userId: string;
  documentId: string;
  documentName: string;
  s3Uri?: string;
  capabilities: string[];
  methods: string[];
  timestamp: string;
  status: 'complete' | 'error';
  source: 'preview' | 'pipeline';
  fileType?: string;
  fileSize?: number;
  pageCount?: number;
  documentLanguages?: string[];
  conversationSummary?: string;
  results: any[];
  comparison: any;
  pipelineDefinition?: any;
  selectedPipelineMethod?: string;
  architectureRecommendation?: string;
  architectureDiagram?: string;
  costProjections?: any[];
  preferredMethod?: string;
}

interface RecentRunsPageProps {
  onLoadRun: (runId: string) => void;
  isAdmin?: boolean;
  /** When true, skip ContentLayout wrapper (for embedding inside another page) */
  embedded?: boolean;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

function formatRelativeTime(ts: string): string {
  try {
    const now = Date.now();
    const then = new Date(ts).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatTimestamp(ts);
  } catch {
    return ts;
  }
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeBadgeColor(ext?: string): 'blue' | 'grey' | 'green' | 'red' {
  if (!ext) return 'grey';
  if (ext === 'pdf') return 'red';
  if (['png', 'jpg', 'jpeg', 'tiff', 'tif'].includes(ext)) return 'green';
  return 'blue';
}

function capabilityLabel(cap: string): string {
  return cap.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract method result metrics from stored results */
function getMethodMetrics(results: any[], method: string): { latencyMs?: number; cost?: number; confidence?: number; status?: string } {
  const r = results.find((res: any) => res.method === method);
  if (!r) return {};
  return {
    latencyMs: r.metrics?.latencyMs,
    cost: r.metrics?.cost,
    confidence: r.metrics?.confidence,
    status: r.status,
  };
}

export default function RecentRunsPage({ onLoadRun, isAdmin = false, embedded = false }: RecentRunsPageProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [showAllUsers, setShowAllUsers] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (showAllUsers && isAdmin) params.set('all', 'true');
      const res = await authedFetch(`/api/runs?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch runs (${res.status})`);
      }
      const data = await res.json() as { runs: RunSummary[]; count: number };
      setRuns(data.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recent runs');
    } finally {
      setLoading(false);
    }
  }, [showAllUsers, isAdmin]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Fetch full detail when a row is selected
  useEffect(() => {
    if (!selectedRun) {
      setRunDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      try {
        const res = await authedFetch(`/api/runs/${selectedRun.runId}`);
        if (!res.ok) throw new Error('Failed to load run details');
        const data = await res.json() as RunDetail;
        if (!cancelled) setRunDetail(data);
      } catch {
        if (!cancelled) setRunDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRun]);

  const handleLoadRun = useCallback(async (runId: string) => {
    setLoadingRunId(runId);
    try {
      onLoadRun(runId);
    } finally {
      setTimeout(() => setLoadingRunId(null), 2000);
    }
  }, [onLoadRun]);

  const columnDefinitions = [
    {
      id: 'documentName',
      header: 'Document',
      cell: (item: RunSummary) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Badge color={fileTypeBadgeColor(item.fileType)}>
            {(item.fileType ?? 'file').toUpperCase()}
          </Badge>
          <Box fontWeight="bold">
            {decodeURIComponent(item.documentName)}
          </Box>
        </SpaceBetween>
      ),
      sortingField: 'documentName',
    },
    ...(showAllUsers && isAdmin ? [{
      id: 'userId',
      header: 'User',
      cell: (item: RunSummary) => item.userId,
      width: 120,
      sortingField: 'userId',
    }] : []),
    {
      id: 'source',
      header: 'Type',
      cell: (item: RunSummary) => (
        <Badge color={item.source === 'pipeline' ? 'blue' : 'grey'}>
          {item.source}
        </Badge>
      ),
      width: 100,
    },
    {
      id: 'capabilities',
      header: 'Capabilities',
      cell: (item: RunSummary) => (
        <span title={item.capabilities.map(capabilityLabel).join(', ')}>
          {item.capabilities.length} cap{item.capabilities.length !== 1 ? 's' : ''}
        </span>
      ),
      width: 110,
    },
    {
      id: 'methods',
      header: 'Methods',
      cell: (item: RunSummary) => (
        <span title={item.methods.join(', ')}>
          {item.methods.length} method{item.methods.length !== 1 ? 's' : ''}
        </span>
      ),
      width: 110,
    },
    {
      id: 'timestamp',
      header: 'Date',
      cell: (item: RunSummary) => (
        <span title={formatTimestamp(item.timestamp)}>
          {formatRelativeTime(item.timestamp)}
        </span>
      ),
      sortingField: 'timestamp',
      width: 120,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (item: RunSummary) => (
        <StatusIndicator type={item.status === 'complete' ? 'success' : 'error'}>
          {item.status === 'complete' ? 'Complete' : 'Error'}
        </StatusIndicator>
      ),
      width: 110,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (item: RunSummary) => (
        <Button
          variant="inline-link"
          onClick={() => handleLoadRun(item.runId)}
          loading={loadingRunId === item.runId}
          disabled={loadingRunId !== null}
        >
          Load results
        </Button>
      ),
      width: 130,
    },
  ];

  const tableAndDetail = (
      <SpaceBetween size="l">
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}
        <Table
          header={embedded ? (
            <Header
              variant="h2"
              counter={`(${runs.length})`}
              actions={
                <SpaceBetween direction="horizontal" size="m">
                  {isAdmin && (
                    <Toggle
                      checked={showAllUsers}
                      onChange={({ detail }) => setShowAllUsers(detail.checked)}
                    >
                      Show all users
                    </Toggle>
                  )}
                  <Button iconName="refresh" onClick={fetchRuns} loading={loading}>
                    Refresh
                  </Button>
                </SpaceBetween>
              }
            >
              Evaluation Runs
            </Header>
          ) : undefined}
          loading={loading}
          loadingText="Loading recent runs..."
          items={runs}
          selectionType="single"
          selectedItems={selectedRun ? [selectedRun] : []}
          onSelectionChange={({ detail }) => {
            const item = detail.selectedItems[0] ?? null;
            setSelectedRun(item === selectedRun ? null : item);
          }}
          trackBy="runId"
          empty={
            <Box textAlign="center" padding="xxl">
              <SpaceBetween size="m">
                <Box variant="p" color="text-body-secondary">
                  No recent evaluations found.
                </Box>
                <Box variant="p" color="text-body-secondary">
                  Upload a document and run a preview or pipeline to see your runs here.
                </Box>
                <Button href="/" variant="primary">Upload a document</Button>
              </SpaceBetween>
            </Box>
          }
          columnDefinitions={columnDefinitions}
          variant="embedded"
          stripedRows
          stickyHeader
        />

        {/* Detail panel — shown when a row is selected */}
        {selectedRun && (
          <Container
            header={
              <Header
                variant="h2"
                actions={
                  <Button
                    variant="primary"
                    onClick={() => handleLoadRun(selectedRun.runId)}
                    loading={loadingRunId === selectedRun.runId}
                  >
                    Load full results
                  </Button>
                }
              >
                {decodeURIComponent(selectedRun.documentName)}
              </Header>
            }
          >
            {detailLoading ? (
              <Box textAlign="center" padding="l">
                <StatusIndicator type="loading">Loading run details...</StatusIndicator>
              </Box>
            ) : runDetail ? (
              <SpaceBetween size="l">
                {/* Upload section */}
                <ExpandableSection headerText="Upload Info" defaultExpanded>
                  <KeyValuePairs
                    columns={4}
                    items={[
                      { label: 'Document', value: decodeURIComponent(runDetail.documentName) },
                      { label: 'File type', value: runDetail.fileType ? runDetail.fileType.toUpperCase() : '-' },
                      { label: 'File size', value: formatFileSize(runDetail.fileSize) },
                      { label: 'Pages', value: runDetail.pageCount ? String(runDetail.pageCount) : '-' },
                      { label: 'Document ID', value: runDetail.documentId },
                      { label: 'Run time', value: formatTimestamp(runDetail.timestamp) },
                      ...(showAllUsers && isAdmin ? [{ label: 'User', value: runDetail.userId }] : []),
                    ]}
                  />
                </ExpandableSection>

                {/* Analysis section */}
                <ExpandableSection headerText="Analysis" defaultExpanded>
                  <SpaceBetween size="m">
                    <div>
                      <Box variant="awsui-key-label">Capabilities ({runDetail.capabilities.length})</Box>
                      <SpaceBetween direction="horizontal" size="xs">
                        {runDetail.capabilities.map((cap) => (
                          <Badge key={cap} color="blue">{capabilityLabel(cap)}</Badge>
                        ))}
                      </SpaceBetween>
                    </div>
                    {runDetail.documentLanguages && runDetail.documentLanguages.length > 0 && (
                      <div>
                        <Box variant="awsui-key-label">Languages</Box>
                        <SpaceBetween direction="horizontal" size="xs">
                          {runDetail.documentLanguages.map((lang) => (
                            <Badge key={lang}>{lang}</Badge>
                          ))}
                        </SpaceBetween>
                      </div>
                    )}
                    {runDetail.conversationSummary && (
                      <div>
                        <Box variant="awsui-key-label">Conversation Summary</Box>
                        <Box variant="p">{runDetail.conversationSummary}</Box>
                      </div>
                    )}
                  </SpaceBetween>
                </ExpandableSection>

                {/* Methods / Results section */}
                <ExpandableSection headerText="Methods and Results" defaultExpanded>
                  <SpaceBetween size="m">
                    <div>
                      <Box variant="awsui-key-label">Methods ({runDetail.methods.length})</Box>
                      <SpaceBetween direction="horizontal" size="xs">
                        {runDetail.methods.map((m) => (
                          <Badge key={m} color="grey">{m}</Badge>
                        ))}
                      </SpaceBetween>
                    </div>
                    {runDetail.results && runDetail.results.length > 0 && (
                      <Table
                        items={runDetail.results}
                        columnDefinitions={[
                          {
                            id: 'method',
                            header: 'Method',
                            cell: (item: any) => item.method ?? '-',
                          },
                          {
                            id: 'status',
                            header: 'Status',
                            cell: (item: any) => (
                              <StatusIndicator type={item.status === 'complete' ? 'success' : 'error'}>
                                {item.status ?? '-'}
                              </StatusIndicator>
                            ),
                          },
                          {
                            id: 'latency',
                            header: 'Latency',
                            cell: (item: any) => {
                              const ms = item.metrics?.latencyMs;
                              if (!ms) return '-';
                              return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
                            },
                          },
                          {
                            id: 'cost',
                            header: 'Cost',
                            cell: (item: any) => {
                              const cost = item.metrics?.cost;
                              return cost != null ? `$${cost.toFixed(4)}` : '-';
                            },
                          },
                          {
                            id: 'confidence',
                            header: 'Confidence',
                            cell: (item: any) => {
                              const conf = item.metrics?.confidence;
                              return conf != null ? `${(conf * 100).toFixed(0)}%` : '-';
                            },
                          },
                        ]}
                        variant="embedded"
                        stripedRows
                      />
                    )}
                  </SpaceBetween>
                </ExpandableSection>

                {/* Pipeline section — only for pipeline runs */}
                {runDetail.source === 'pipeline' && runDetail.pipelineDefinition && (
                  <ExpandableSection headerText="Pipeline Details">
                    <SpaceBetween size="s">
                      <KeyValuePairs
                        columns={3}
                        items={[
                          {
                            label: 'Pipeline name',
                            value: (runDetail.pipelineDefinition as any)?.name ?? '-',
                          },
                          {
                            label: 'Nodes',
                            value: String((runDetail.pipelineDefinition as any)?.nodes?.length ?? 0),
                          },
                          {
                            label: 'Selected method',
                            value: runDetail.selectedPipelineMethod ?? '-',
                          },
                        ]}
                      />
                    </SpaceBetween>
                  </ExpandableSection>
                )}

                {/* Architecture section */}
                {runDetail.architectureRecommendation && (
                  <ExpandableSection headerText="Architecture Recommendation">
                    <Box variant="p">
                      {runDetail.architectureRecommendation.length > 500
                        ? runDetail.architectureRecommendation.substring(0, 500) + '...'
                        : runDetail.architectureRecommendation}
                    </Box>
                  </ExpandableSection>
                )}

                {/* Comparison summary */}
                {runDetail.comparison && (
                  <ExpandableSection headerText="Comparison Summary">
                    <ColumnLayout columns={3}>
                      <div>
                        <Box variant="awsui-key-label">Best overall</Box>
                        <Box>{(runDetail.comparison as any)?.bestOverall ?? '-'}</Box>
                      </div>
                      <div>
                        <Box variant="awsui-key-label">Best cost</Box>
                        <Box>{(runDetail.comparison as any)?.bestCost ?? '-'}</Box>
                      </div>
                      <div>
                        <Box variant="awsui-key-label">Best speed</Box>
                        <Box>{(runDetail.comparison as any)?.bestSpeed ?? '-'}</Box>
                      </div>
                    </ColumnLayout>
                  </ExpandableSection>
                )}
              </SpaceBetween>
            ) : (
              <Box textAlign="center" padding="l" color="text-body-secondary">
                Could not load details for this run.
              </Box>
            )}
          </Container>
        )}
      </SpaceBetween>
  );

  if (embedded) {
    return tableAndDetail;
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="View and reload your past evaluation sessions"
          actions={
            <SpaceBetween direction="horizontal" size="m">
              {isAdmin && (
                <Toggle
                  checked={showAllUsers}
                  onChange={({ detail }) => setShowAllUsers(detail.checked)}
                >
                  Show all users
                </Toggle>
              )}
              <Button iconName="refresh" onClick={fetchRuns} loading={loading}>
                Refresh
              </Button>
            </SpaceBetween>
          }
        >
          Recent Runs
        </Header>
      }
    >
      {tableAndDetail}
    </ContentLayout>
  );
}
