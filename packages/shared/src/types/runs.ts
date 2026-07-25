/**
 * How far an evaluation actually got, and therefore where it resumes.
 *
 * A run record only carried `status: 'complete' | 'error'`, which conflated two
 * very different things: a preview-only run (methods compared, no pipeline built)
 * was labelled "Complete" identically to a full evaluation that reached
 * architecture generation. The Recent Runs list therefore showed complete and
 * incomplete work as the same thing, and "Load" gave no indication of which step
 * you would land on.
 *
 * The stage is DERIVED from what the record contains rather than stored, so it
 * cannot drift from reality and old records classify correctly too.
 */
export type RunStage =
  /** No method produced a result. Nothing to resume. */
  | 'failed'
  /** Methods were compared. Resume at Analyze & Preview to choose one. */
  | 'previewed'
  /** A pipeline was executed. Resume at Pipeline to see the run. */
  | 'executed'
  /** Comparison exists, so architecture and code can be generated. */
  | 'analyzed';

export interface RunStageInfo {
  stage: RunStage;
  /** Short label for a status column. */
  label: string;
  /** Which of the four workflow steps this run reached (1-4). */
  step: number;
  /** Route to open when resuming. */
  resumeHref: string;
  /** Action label, stating where the user will land. */
  resumeLabel: string;
  /** Whether the evaluation ran to the end of the workflow. */
  isComplete: boolean;
}

/**
 * Minimal shape needed to classify a run; both the list summary and the full
 * record satisfy it.
 *
 * Fields are widened (`string`, `{ length: number }`) rather than pinned to the
 * exact union/array types so that callers holding a looser local interface — the
 * frontend's `RunDetail` uses `results: any[]` — can pass their object without a
 * cast. Classification only reads whether values are present.
 */
export interface RunStageInput {
  status?: string;
  source?: string;
  methods?: { length: number } | null;
  results?: { length: number } | null;
  comparison?: unknown;
  pipelineDefinition?: unknown;
}

/**
 * Classify a run by what it actually contains.
 *
 * Ordered most- to least-complete, because a run that reached architecture also
 * satisfies the earlier conditions.
 */
export function getRunStage(run: RunStageInput): RunStageInfo {
  const producedResults = (run.results?.length ?? 0) > 0 || (run.methods?.length ?? 0) > 0;

  if (run.status === 'error' || !producedResults) {
    return {
      stage: 'failed',
      label: 'Failed',
      step: 1,
      resumeHref: '/',
      resumeLabel: 'Start over',
      isComplete: false,
    };
  }

  if (run.comparison) {
    return {
      stage: 'analyzed',
      label: 'Complete',
      step: 4,
      resumeHref: '/architecture',
      resumeLabel: 'Open architecture',
      isComplete: true,
    };
  }

  if (run.pipelineDefinition || run.source === 'pipeline') {
    return {
      stage: 'executed',
      label: 'Pipeline run',
      step: 3,
      resumeHref: '/pipeline',
      resumeLabel: 'Open pipeline',
      isComplete: false,
    };
  }

  return {
    stage: 'previewed',
    label: 'Preview only',
    step: 2,
    resumeHref: '/conversation',
    resumeLabel: 'Resume at Analyze',
    isComplete: false,
  };
}
