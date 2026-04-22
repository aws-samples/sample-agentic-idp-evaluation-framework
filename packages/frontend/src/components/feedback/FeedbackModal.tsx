import { useState, useMemo } from 'react';
import Modal from '@cloudscape-design/components/modal';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import Textarea from '@cloudscape-design/components/textarea';
import Alert from '@cloudscape-design/components/alert';
import {
  FEEDBACK_RATING_MAX,
  FEEDBACK_RATING_MIN,
  FEEDBACK_RATING_STEP,
} from '@idp/shared';
import { authedFetch } from '../../services/api';

interface FeedbackModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmitted: () => void;
}

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const activeValue = hover ?? value;

  const stars = useMemo(() => {
    const count = Math.floor(FEEDBACK_RATING_MAX);
    return Array.from({ length: count }, (_, i) => i + 1);
  }, []);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {stars.map((starIndex) => {
        const fullThreshold = starIndex;
        const halfThreshold = starIndex - FEEDBACK_RATING_STEP;
        const isFull = activeValue >= fullThreshold;
        const isHalf = !isFull && activeValue >= halfThreshold;

        return (
          <div
            key={starIndex}
            style={{ position: 'relative', width: 32, height: 32, cursor: 'pointer' }}
            onMouseLeave={() => setHover(null)}
          >
            {/* Left half (0.5) */}
            <div
              aria-label={`${halfThreshold} stars`}
              role="button"
              tabIndex={0}
              onMouseEnter={() => setHover(halfThreshold)}
              onClick={() => onChange(halfThreshold)}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '50%',
                height: '100%',
                zIndex: 2,
              }}
            />
            {/* Right half (full star) */}
            <div
              aria-label={`${fullThreshold} stars`}
              role="button"
              tabIndex={0}
              onMouseEnter={() => setHover(fullThreshold)}
              onClick={() => onChange(fullThreshold)}
              style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                width: '50%',
                height: '100%',
                zIndex: 2,
              }}
            />
            {/* Base (gray) star */}
            <svg viewBox="0 0 24 24" width="32" height="32" style={{ position: 'absolute', inset: 0 }}>
              <path
                d="M12 2 L14.9 8.6 L22 9.3 L16.5 14 L18.1 21 L12 17.3 L5.9 21 L7.5 14 L2 9.3 L9.1 8.6 Z"
                fill="#d5dbdb"
              />
            </svg>
            {/* Foreground (blue) — full or half */}
            {(isFull || isHalf) && (
              <svg
                viewBox="0 0 24 24"
                width="32"
                height="32"
                style={{ position: 'absolute', inset: 0 }}
              >
                <defs>
                  <clipPath id={`clip-${starIndex}-${isFull ? 'full' : 'half'}`}>
                    <rect x="0" y="0" width={isFull ? 24 : 12} height="24" />
                  </clipPath>
                </defs>
                <path
                  d="M12 2 L14.9 8.6 L22 9.3 L16.5 14 L18.1 21 L12 17.3 L5.9 21 L7.5 14 L2 9.3 L9.1 8.6 Z"
                  fill="#0972d3"
                  clipPath={`url(#clip-${starIndex}-${isFull ? 'full' : 'half'})`}
                />
              </svg>
            )}
          </div>
        );
      })}
      <Box variant="p" margin={{ left: 's' }}>
        <span style={{ fontWeight: 600, color: '#0972d3' }}>
          {activeValue > 0 ? activeValue.toFixed(1) : '0.0'}
        </span>
        <span style={{ color: '#687078' }}> / {FEEDBACK_RATING_MAX}</span>
      </Box>
    </div>
  );
}

export default function FeedbackModal({ visible, onDismiss, onSubmitted }: FeedbackModalProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = rating >= FEEDBACK_RATING_MIN && !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await authedFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Failed (${res.status})`);
      }
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Share your feedback"
      size="medium"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={submitting}>
              Maybe later
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
              Submit feedback
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        <Box>
          How would you rate your experience with the ONE IDP evaluation platform? Your feedback helps
          us understand what's working and what needs improvement. This is a one-time ask per user.
        </Box>

        <FormField label="Overall rating" description={`Click to rate from ${FEEDBACK_RATING_MIN} to ${FEEDBACK_RATING_MAX} stars (half-star increments).`}>
          <StarRating value={rating} onChange={setRating} />
        </FormField>

        <FormField
          label="What could be better? (optional)"
          description="Specific pain points, missing capabilities, or ideas — anything helps."
        >
          <Textarea
            value={comment}
            onChange={({ detail }) => setComment(detail.value)}
            placeholder="E.g., document splitting for large PDFs, support for..."
            rows={4}
          />
        </FormField>

        {error && <Alert type="error">{error}</Alert>}
      </SpaceBetween>
    </Modal>
  );
}
