import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
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

export async function getActivityStats(): Promise<{
  totalUsers: number;
  totalUploads: number;
  totalConversations: number;
  totalPreviews: number;
  recentActivity: ActivityRecord[];
}> {
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
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
