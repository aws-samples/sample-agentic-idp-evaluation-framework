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
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          <li>This environment is not covered by an AWS Service Level Agreement.</li>
          <li>
            Do not upload documents containing personally identifiable information, protected
            health information, financial records, or any sensitive/confidential data.
          </li>
          <li>This application does not represent an AWS product, managed service, or deliverable.</li>
        </ul>
      </Alert>
    </Box>
  );
}
