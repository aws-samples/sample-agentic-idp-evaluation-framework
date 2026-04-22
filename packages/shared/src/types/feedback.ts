/**
 * User feedback survey — one submission per user, persisted forever.
 * Rating is on a 0.5–5 scale with 0.5 increments (so 10 discrete values).
 */

export interface FeedbackRequest {
  rating: number;
  comment?: string;
}

export interface FeedbackRecord {
  userId: string;
  rating: number;
  comment?: string;
  submittedAt: string;
}

export interface FeedbackStatus {
  submitted: boolean;
  submittedAt?: string;
}

export interface FeedbackSummary {
  totalSubmissions: number;
  averageRating: number | null;
  distribution: Record<string, number>;
  records: FeedbackRecord[];
}

export const FEEDBACK_RATING_MIN = 0.5;
export const FEEDBACK_RATING_MAX = 5;
export const FEEDBACK_RATING_STEP = 0.5;
