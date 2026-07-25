/**
 * The four workflow steps, defined ONCE.
 *
 * The nav labels and the page titles were written separately and disagreed: the nav
 * said "Analyze & Preview", "Pipeline" and "Architecture & Code" while the pages
 * titled themselves "Document Analysis", "Pipeline Builder" and "Architecture &
 * Code". A user clicking a nav item landed on a page with a different name and had to
 * work out whether they were in the right place.
 *
 * `description` is written for a first-time user — what happens on this step and what
 * they get out of it, not what the software does internally.
 */
export interface WorkflowStep {
  /** Route path. */
  href: string;
  /** Nav label AND page title — the same string in both places, by construction. */
  title: string;
  /** One line under the page title: what this step does, in the user's terms. */
  description: string;
  /** Shown when the step is not yet reachable, naming the action that unblocks it. */
  gate: string;
}

export const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  {
    href: '/',
    title: 'Upload',
    description:
      'Start with one real document — a PDF, image, Word, Excel or PowerPoint file. '
      + 'Everything after this is measured against your document, not a sample.',
    gate: 'Upload a document to begin.',
  },
  {
    href: '/conversation',
    title: 'Analyze & Compare',
    description:
      'An advisor reads your document and suggests what to extract. Every applicable '
      + 'method then runs in parallel so you can compare real cost, speed and output '
      + 'side by side.',
    gate:
      'Upload a document first — the advisor reads it to work out what can be '
      + 'extracted.',
  },
  {
    href: '/pipeline',
    title: 'Build Pipeline',
    description:
      'Assemble the methods you chose into a pipeline and run it end to end, so you '
      + 'see what a production run would actually produce and cost.',
    gate:
      'Choose a method in Analyze & Compare first — the pipeline is built around the '
      + 'capabilities your document needs.',
  },
  {
    href: '/architecture',
    title: 'Architecture & Code',
    description:
      'Get a deployable project — Python, TypeScript and CDK — wired to the exact '
      + 'methods you picked, with cost projections based on your measured run.',
    gate:
      'Run a pipeline first — the architecture and code are generated from what your '
      + 'run actually measured.',
  },
];

/** Step number (1-based) for a route, or 0 when the path is not a workflow step. */
export function stepNumber(href: string): number {
  return WORKFLOW_STEPS.findIndex((s) => s.href === href) + 1;
}

export const TOTAL_STEPS = WORKFLOW_STEPS.length;

/**
 * "Step 2 of 4 · invoice.pdf · 6 pages" — the sub-title every step page shows.
 *
 * Built here so the format cannot drift between pages, and so the step NUMBER always
 * matches the position in WORKFLOW_STEPS rather than being hardcoded per page (step 3
 * once read "Step 3 of 4" on a page reachable as step 2).
 */
export function stepSubtitle(
  href: string,
  fileName?: string,
  pageCount?: number,
): string {
  const n = stepNumber(href);
  const parts = [n > 0 ? `Step ${n} of ${TOTAL_STEPS}` : ''];
  if (fileName) parts.push(fileName);
  if (pageCount != null) parts.push(`${pageCount} page${pageCount === 1 ? '' : 's'}`);
  return parts.filter(Boolean).join(' · ');
}
