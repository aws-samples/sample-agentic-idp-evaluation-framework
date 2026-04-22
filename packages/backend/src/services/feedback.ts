import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, config } from '../config/aws.js';
import type {
  FeedbackRecord,
  FeedbackStatus,
  FeedbackSummary,
} from '@idp/shared';
import {
  FEEDBACK_RATING_MIN,
  FEEDBACK_RATING_MAX,
  FEEDBACK_RATING_STEP,
} from '@idp/shared';

// We reuse the activity table with a fixed sort key so each user has exactly one row.
// userId = alias, sk = 'feedback#submission'.
const FEEDBACK_SK = 'feedback#submission';
const FEEDBACK_TYPE = 'feedback';

function assertValidRating(rating: number): void {
  if (
    typeof rating !== 'number' ||
    Number.isNaN(rating) ||
    rating < FEEDBACK_RATING_MIN ||
    rating > FEEDBACK_RATING_MAX
  ) {
    throw new Error(`Rating must be between ${FEEDBACK_RATING_MIN} and ${FEEDBACK_RATING_MAX}`);
  }
  const steps = rating / FEEDBACK_RATING_STEP;
  if (Math.abs(Math.round(steps) - steps) > 1e-6) {
    throw new Error(`Rating must be in increments of ${FEEDBACK_RATING_STEP}`);
  }
}

export async function getFeedbackStatus(userId: string): Promise<FeedbackStatus> {
  if (!config.activityTable) return { submitted: false };
  const res = await docClient.send(new GetCommand({
    TableName: config.activityTable,
    Key: { userId, sk: FEEDBACK_SK },
  }));
  if (!res.Item) return { submitted: false };
  return {
    submitted: true,
    submittedAt: (res.Item.submittedAt as string | undefined) ?? (res.Item.timestamp as string | undefined),
  };
}

export async function submitFeedback(
  userId: string,
  rating: number,
  comment: string | undefined,
): Promise<FeedbackRecord> {
  assertValidRating(rating);
  if (!config.activityTable) throw new Error('Activity table not configured');

  const existing = await getFeedbackStatus(userId);
  if (existing.submitted) {
    throw new Error('Feedback already submitted for this user');
  }

  const submittedAt = new Date().toISOString();
  const trimmedComment = comment?.trim().slice(0, 2000) ?? '';
  const record: FeedbackRecord = {
    userId,
    rating,
    submittedAt,
    ...(trimmedComment ? { comment: trimmedComment } : {}),
  };

  await docClient.send(new PutCommand({
    TableName: config.activityTable,
    Item: {
      userId,
      sk: FEEDBACK_SK,
      type: FEEDBACK_TYPE,
      timestamp: submittedAt,
      submittedAt,
      rating,
      ...(trimmedComment ? { comment: trimmedComment } : {}),
    },
    // Make submission idempotent: no overwrite if a row already exists.
    ConditionExpression: 'attribute_not_exists(userId)',
  }));

  return record;
}

export async function getFeedbackSummary(): Promise<FeedbackSummary> {
  if (!config.activityTable) {
    return { totalSubmissions: 0, averageRating: null, distribution: {}, records: [] };
  }
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
  const res = await docClient.send(new ScanCommand({
    TableName: config.activityTable,
    FilterExpression: 'sk = :sk',
    ExpressionAttributeValues: { ':sk': FEEDBACK_SK },
  }));
  const items = (res.Items ?? []) as Array<{
    userId: string;
    rating: number;
    comment?: string;
    submittedAt?: string;
    timestamp?: string;
  }>;

  const records: FeedbackRecord[] = items
    .map((i) => ({
      userId: i.userId,
      rating: i.rating,
      comment: i.comment,
      submittedAt: i.submittedAt ?? i.timestamp ?? new Date(0).toISOString(),
    }))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  const distribution: Record<string, number> = {};
  let sum = 0;
  for (const r of records) {
    sum += r.rating;
    const key = r.rating.toFixed(1);
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  return {
    totalSubmissions: records.length,
    averageRating: records.length > 0 ? Math.round((sum / records.length) * 100) / 100 : null,
    distribution,
    records,
  };
}
