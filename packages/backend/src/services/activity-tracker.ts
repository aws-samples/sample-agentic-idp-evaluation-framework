import { PutCommand, QueryCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, config } from '../config/aws.js';

export type ActivityType =
  | 'upload'
  | 'conversation_start'
  | 'conversation_message'
  | 'preview_start'
  | 'preview_complete'
  | 'pipeline_start'
  | 'pipeline_complete'
  | 'architecture_generate';

export interface ActivityRecord {
  userId: string;
  sk: string; // ISO timestamp#type for sort key
  type: ActivityType;
  timestamp: string;
  documentId?: string;
  fileName?: string;
  s3Uri?: string;
  details?: Record<string, unknown>;
}

export interface RunRecord {
  userId: string;
  sk: string; // run#<runId>
  runId: string;
  timestamp: string;
  status: 'complete' | 'error';
  source: 'preview' | 'pipeline';

  // Upload info
  documentId: string;
  documentName: string;
  s3Uri?: string;
  fileSize?: number;
  pageCount?: number;
  fileType?: string;

  // Analysis phase
  capabilities: string[];
  documentLanguages?: string[];
  conversationSummary?: string;

  // Preview / Processing results
  methods: string[];
  results: unknown[]; // ProcessorResult[]
  comparison: unknown | null; // ComparisonResult

  // Pipeline details
  pipelineDefinition?: unknown; // PipelineDefinition
  selectedPipelineMethod?: string;

  // Architecture
  architectureRecommendation?: string;
  architectureDiagram?: string;
  costProjections?: unknown[];

  // User's final selections
  preferredMethod?: string;
}

export async function trackActivity(
  userId: string,
  type: ActivityType,
  data: {
    documentId?: string;
    fileName?: string;
    s3Uri?: string;
    details?: Record<string, unknown>;
  } = {},
): Promise<void> {
  if (!config.activityTable) return;

  const timestamp = new Date().toISOString();
  const record: ActivityRecord = {
    userId,
    sk: `${timestamp}#${type}`,
    type,
    timestamp,
    ...data,
  };

  try {
    await docClient.send(new PutCommand({
      TableName: config.activityTable,
      Item: record,
    }));
  } catch (err) {
    // Non-blocking — don't fail the request if tracking fails
    console.warn('[Activity Tracker] Failed to record activity:', (err as Error).message);
  }
}

export async function queryActivity(options: {
  userId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<ActivityRecord[]> {
  const { userId, startDate, endDate, limit = 100 } = options;

  if (userId) {
    // Query specific user
    const params: Record<string, unknown> = {
      TableName: config.activityTable,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId } as Record<string, unknown>,
      ScanIndexForward: false, // newest first
      Limit: limit,
    };

    if (startDate && endDate) {
      (params as any).KeyConditionExpression += ' AND sk BETWEEN :start AND :end';
      (params.ExpressionAttributeValues as Record<string, unknown>)[':start'] = startDate;
      (params.ExpressionAttributeValues as Record<string, unknown>)[':end'] = endDate + '\uffff';
    } else if (startDate) {
      (params as any).KeyConditionExpression += ' AND sk >= :start';
      (params.ExpressionAttributeValues as Record<string, unknown>)[':start'] = startDate;
    }

    const result = await docClient.send(new QueryCommand(params as any));
    return (result.Items ?? []) as ActivityRecord[];
  }

  // Scan all users (admin view) — use ScanCommand for cross-user queries
  const params: Record<string, unknown> = {
    TableName: config.activityTable,
    Limit: limit,
  };

  if (startDate) {
    (params as any).FilterExpression = '#ts >= :start';
    (params as any).ExpressionAttributeNames = { '#ts': 'timestamp' };
    (params as any).ExpressionAttributeValues = { ':start': startDate };
  }

  const result = await docClient.send(new ScanCommand(params as any));
  // Sort by timestamp descending
  const items = (result.Items ?? []) as ActivityRecord[];
  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return items;
}

/**
 * Save full run results so they can be reloaded later.
 * Uses SK prefix `run#<runId>` to distinguish from activity log entries.
 * All new fields are optional for backwards compatibility.
 */
export async function trackRunResults(
  userId: string,
  data: {
    runId: string;
    documentId: string;
    documentName: string;
    s3Uri?: string;
    capabilities: string[];
    methods: string[];
    results: unknown[];
    comparison: unknown | null;
    source: 'preview' | 'pipeline';
    status?: 'complete' | 'error';
    // Extended fields
    fileSize?: number;
    pageCount?: number;
    fileType?: string;
    documentLanguages?: string[];
    conversationSummary?: string;
    pipelineDefinition?: unknown;
    selectedPipelineMethod?: string;
    architectureRecommendation?: string;
    architectureDiagram?: string;
    costProjections?: unknown[];
    preferredMethod?: string;
  },
): Promise<void> {
  if (!config.activityTable) return;

  const timestamp = new Date().toISOString();
  const record: RunRecord = {
    userId,
    sk: `run#${data.runId}`,
    runId: data.runId,
    timestamp,
    status: data.status ?? 'complete',
    source: data.source,
    documentId: data.documentId,
    documentName: data.documentName,
    s3Uri: data.s3Uri,
    fileSize: data.fileSize,
    pageCount: data.pageCount,
    fileType: data.fileType,
    capabilities: data.capabilities,
    documentLanguages: data.documentLanguages,
    conversationSummary: data.conversationSummary,
    methods: data.methods,
    results: data.results,
    comparison: data.comparison,
    pipelineDefinition: data.pipelineDefinition,
    selectedPipelineMethod: data.selectedPipelineMethod,
    architectureRecommendation: data.architectureRecommendation,
    architectureDiagram: data.architectureDiagram,
    costProjections: data.costProjections,
    preferredMethod: data.preferredMethod,
  };

  // Strip undefined values so DynamoDB doesn't store them
  const cleanRecord = Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== undefined),
  );

  try {
    await docClient.send(new PutCommand({
      TableName: config.activityTable,
      Item: cleanRecord,
    }));
  } catch (err) {
    console.warn('[Activity Tracker] Failed to save run results:', (err as Error).message);
  }
}

/**
 * Get recent runs for a user, sorted newest-first.
 */
export async function getRecentRuns(userId: string, limit = 20): Promise<RunRecord[]> {
  if (!config.activityTable) return [];

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: config.activityTable,
      KeyConditionExpression: 'userId = :uid AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':uid': userId,
        ':prefix': 'run#',
      },
      ScanIndexForward: false,
      Limit: limit,
    }));

    const items = (result.Items ?? []) as RunRecord[];
    // DynamoDB sorts by SK lexicographically; run#<uuid> is not time-ordered.
    // Sort by timestamp descending in-memory.
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return items.slice(0, limit);
  } catch (err) {
    console.warn('[Activity Tracker] Failed to query runs:', (err as Error).message);
    return [];
  }
}

/**
 * Get recent runs across ALL users (admin view).
 * Uses a Scan with `begins_with(sk, 'run#')` filter, sorted by timestamp descending.
 */
export async function getAllRecentRuns(limit = 50): Promise<RunRecord[]> {
  if (!config.activityTable) return [];

  try {
    const result = await docClient.send(new ScanCommand({
      TableName: config.activityTable,
      FilterExpression: 'begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': 'run#',
      },
    }));

    const items = (result.Items ?? []) as RunRecord[];
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return items.slice(0, limit);
  } catch (err) {
    console.warn('[Activity Tracker] Failed to scan all runs:', (err as Error).message);
    return [];
  }
}

/**
 * Get a single run by runId for a specific user.
 */
export async function getRunById(userId: string, runId: string): Promise<RunRecord | null> {
  if (!config.activityTable) return null;

  try {
    const result = await docClient.send(new GetCommand({
      TableName: config.activityTable,
      Key: {
        userId,
        sk: `run#${runId}`,
      },
    }));
    return (result.Item as RunRecord) ?? null;
  } catch (err) {
    console.warn('[Activity Tracker] Failed to get run:', (err as Error).message);
    return null;
  }
}

export async function getActivityStats(): Promise<{
  totalUsers: number;
  totalUploads: number;
  totalConversations: number;
  totalPreviews: number;
  recentActivity: ActivityRecord[];
}> {
  const result = await docClient.send(new ScanCommand({
    TableName: config.activityTable,
  }));

  const items = (result.Items ?? []) as ActivityRecord[];
  const users = new Set(items.map((i) => i.userId));

  return {
    totalUsers: users.size,
    totalUploads: items.filter((i) => i.type === 'upload').length,
    totalConversations: items.filter((i) => i.type === 'conversation_start').length,
    totalPreviews: items.filter((i) => i.type === 'preview_start').length,
    recentActivity: items
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 50),
  };
}
