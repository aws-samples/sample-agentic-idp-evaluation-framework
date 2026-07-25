import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';

/**
 * Site-wide disclaimer for the public-facing demo endpoints. Intentionally
 * not dismissible: this is the written notice that the environment is a
 * demonstration, carries no SLA, and must not receive sensitive data.
 */
export default function DisclaimerBanner() {
  return (
    <Box padding={{ horizontal: 's', top: 's' }}>
      <Alert
        type="warning"
        statusIconAriaLabel="Warning"
        header="This application is a demonstration of AWS intelligent document processing capabilities. It is provided for evaluation and educational purposes only."
      >
        {/*
          The upload control used to repeat a longer version of the data warning
          directly below this banner, so the same prohibition appeared twice on
          one screen. The full wording now lives here once, and the upload step
          carries only a short pointer back to it.
        */}
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          <li>This environment is not covered by an AWS Service Level Agreement.</li>
          <li>
            <strong>
              Do not upload documents containing personally identifiable information (PII),
              protected health information (PHI), financial records, or any sensitive or
              confidential data.
            </strong>{' '}
            This is a shared demonstration environment — use only sample, synthetic, or fully
            redacted documents.
          </li>
          <li>This application does not represent an AWS product, managed service, or deliverable.</li>
        </ul>
      </Alert>
    </Box>
  );
}
