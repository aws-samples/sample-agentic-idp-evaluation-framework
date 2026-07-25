import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Box from '@cloudscape-design/components/box';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Button from '@cloudscape-design/components/button';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import type { PreviewResponse } from '../../hooks/usePreview';
import { token } from '../../theme/tokens';

/**
 * Collapse failures with the same message into one entry.
 *
 * A timeout or a throttling error hits many methods at once, so listing them
 * individually repeats the same sentence a dozen times. Grouping makes the shared
 * cause obvious — which is the actionable part.
 */
function groupFailures(results: PreviewResponse['results']) {
  const groups = new Map<string, string[]>();
  for (const r of results) {
    if (r.status !== 'error') continue;
    const reason = r.error?.trim() || 'No result returned.';
    const list = groups.get(reason) ?? [];
    list.push(r.shortName);
    groups.set(reason, list);
  }
  return [...groups.entries()].map(([reason, methods]) => ({ reason, methods }));
}

interface PreviewProgressProps {
  preview: PreviewResponse | null;
  isLoading: boolean;
  /** Shown once at least one method has returned, to skip ahead. */
  onContinue?: () => void;
}

/**
 * Live progress for the parallel preview run.
 *
 * The methods genuinely run in parallel and the backend streams each result over
 * SSE the moment it lands, but the UI used to render nothing until every method
 * had finished — so a run where Nova answered in 7s and the slowest method took
 * 16s looked like 16 seconds of a blank screen. That made a fast, parallel system
 * feel slow and serial.
 *
 * This shows every method as a chip that flips from pending → done as its result
 * arrives, so the fan-out is visible and the fastest models are seen being fast.
 */
export default function PreviewProgress({ preview, isLoading, onContinue }: PreviewProgressProps) {
  if (!preview) return null;

  const total = preview.methods.length;
  const finished = preview.results.length;
  const succeeded = preview.results.filter((r) => r.status === 'complete').length;
  const failed = finished - succeeded;
  const done = !isLoading;

  // Fastest successful method so far — the number worth surfacing while waiting.
  const fastest = preview.results
    .filter((r) => r.status === 'complete')
    .reduce<null | { shortName: string; latencyMs: number }>(
      (best, r) => (!best || r.latencyMs < best.latencyMs ? r : best),
      null,
    );

  const resultByMethod = new Map(preview.results.map((r) => [r.method, r]));

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={
            done
              ? `${succeeded} of ${total} methods returned a result${failed > 0 ? `, ${failed} failed` : ''}.`
              : 'Every method runs at the same time. Results appear as each one finishes.'
          }
          actions={
            done && succeeded > 0 && onContinue ? (
              <Button onClick={onContinue}>Compare results</Button>
            ) : undefined
          }
        >
          {done ? 'Preview complete' : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Spinner size="normal" />
              Running {total} methods in parallel
            </span>
          )}
        </Header>
      }
    >
      <SpaceBetween size="m">
        <ProgressBar
          value={total === 0 ? 0 : (finished / total) * 100}
          status={done ? 'success' : 'in-progress'}
          additionalInfo={
            fastest
              ? `Fastest so far: ${fastest.shortName} at ${(fastest.latencyMs / 1000).toFixed(1)}s`
              : undefined
          }
          description={`${finished} of ${total} finished`}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {preview.methods.map((m) => {
            const result = resultByMethod.get(m.method);
            const pending = !result;
            return (
              <div
                key={m.method}
                // Fade+rise as each chip resolves. Purely additive: a chip that is
                // already settled re-renders without re-animating because the key
                // is stable and the animation is tied to the resolved state.
                className={pending ? undefined : 'idp-chip-resolved'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  border: `1px solid ${pending ? token.borderSubtle : token.border}`,
                  background: pending ? 'transparent' : token.surfaceMuted,
                  color: pending ? token.textInactive : token.text,
                }}
              >
                {pending ? (
                  <>
                    <Spinner size="normal" />
                    {m.shortName}
                  </>
                ) : result.status === 'complete' ? (
                  <>
                    <StatusIndicator type="success">{m.shortName}</StatusIndicator>
                    <span style={{ color: token.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                      {(result.latencyMs / 1000).toFixed(1)}s
                    </span>
                  </>
                ) : (
                  <StatusIndicator type="error">{m.shortName}</StatusIndicator>
                )}
              </div>
            );
          })}
        </div>

        {/*
          Failures, grouped by reason and stated in full.
          Each failure used to be repeated in a summary bar truncated to 50
          characters, producing nine near-identical
          "…exceeded the 60s preview limit and w" fragments with no way to read the
          actual message. Identical causes are now collapsed into one line.
        */}
        {failed > 0 && (
          <ExpandableSection
            headerText={`${failed} method${failed === 1 ? '' : 's'} did not return a result`}
          >
            <SpaceBetween size="xs">
              {groupFailures(preview.results).map(({ reason, methods }) => (
                <Box key={reason} fontSize="body-s">
                  <Box variant="strong" fontSize="body-s">{methods.join(', ')}</Box>
                  <Box color="text-body-secondary" fontSize="body-s">{reason}</Box>
                </Box>
              ))}
            </SpaceBetween>
          </ExpandableSection>
        )}
      </SpaceBetween>
    </Container>
  );
}
