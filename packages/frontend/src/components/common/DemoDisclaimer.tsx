import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';

/**
 * Demo/data-handling notice for the public-facing endpoints.
 *
 * This used to be a full-width warning banner pinned above every page, plus a
 * second shorter warning inside the upload control — the same prohibition twice
 * on one screen, and a large yellow block that pushed the actual task down.
 *
 * It now appears in the two places that carry weight:
 *   - {@link UploadDisclaimer} sits with the file picker, which is the moment the
 *     user is about to hand over a document. A data warning is worth most at the
 *     point of data entry.
 *   - {@link DemoFooterNote} is a single quiet line on every page, so the "no
 *     SLA / not an AWS product" notice does not disappear once the user has
 *     navigated past step 1.
 */
export function UploadDisclaimer() {
  return (
    <Alert
      type="warning"
      statusIconAriaLabel="Warning"
      header="Demonstration environment — do not upload sensitive documents"
    >
      Use only sample, synthetic, or fully redacted documents.{' '}
      <strong>
        Do not upload personally identifiable information (PII), protected health
        information (PHI), financial records, or confidential data.
      </strong>{' '}
      This is a shared environment provided for evaluation and educational purposes,
      covered by no AWS Service Level Agreement, and is not an AWS product or
      managed service.
    </Alert>
  );
}

/**
 * One-line persistent notice. Deliberately low-contrast: it must stay visible on
 * every route without competing with the page content.
 */
export function DemoFooterNote() {
  return (
    <Box
      textAlign="center"
      color="text-body-secondary"
      fontSize="body-s"
      padding={{ top: 'xl', bottom: 'l' }}
    >
      Demonstration environment for evaluation and educational purposes · no AWS
      Service Level Agreement · not an AWS product or managed service · do not
      upload PII, PHI, financial or confidential data
    </Box>
  );
}
