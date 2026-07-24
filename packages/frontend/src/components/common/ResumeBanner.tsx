import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';

interface ResumeBannerProps {
  fileName: string;
  /** Number of capabilities currently selected. */
  capabilityCount: number;
  /** True once a pipeline run has produced results. */
  hasResults: boolean;
  /** Server-side run id, shown so a run can be found again later. */
  runId?: string | null;
  onContinue: () => void;
  onStartOver: () => void;
}

/**
 * Tells the user an evaluation is already in progress and offers the two things
 * they actually want: carry on, or start clean.
 *
 * Restored state used to be invisible — reopening the app dropped you on the
 * upload screen with a stale document silently held in storage, so it was never
 * clear whether anything was still loaded, where you had left off, or how to
 * reset. Making the state visible is what makes it feel intuitive.
 */
export default function ResumeBanner({
  fileName,
  capabilityCount,
  hasResults,
  runId,
  onContinue,
  onStartOver,
}: ResumeBannerProps) {
  const where = hasResults
    ? 'Results are ready.'
    : capabilityCount > 0
      ? `${capabilityCount} capabilit${capabilityCount === 1 ? 'y' : 'ies'} selected.`
      : 'Analysis not started yet.';

  return (
    <Alert
      type="info"
      header="You have an evaluation in progress"
      action={
        <SpaceBetween direction="horizontal" size="xs">
          <Button onClick={onStartOver}>Start over</Button>
          <Button variant="primary" onClick={onContinue}>Continue</Button>
        </SpaceBetween>
      }
    >
      <SpaceBetween size="xxs">
        <Box>
          <strong>{fileName}</strong> — {where}
        </Box>
        {runId && (
          <Box color="text-body-secondary" fontSize="body-s">
            Saved as run <code>{runId.slice(0, 8)}</code> — it stays in Recent Runs even if you
            close this tab.
          </Box>
        )}
      </SpaceBetween>
    </Alert>
  );
}
