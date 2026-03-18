import { useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';

const STORAGE_KEY = 'idp-onboarding-dismissed';

export default function OnboardingBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true',
  );

  if (dismissed) return null;

  return (
    <Alert
      type="info"
      header="Welcome to ONE IDP Platform"
      dismissible
      onDismiss={() => {
        setDismissed(true);
        localStorage.setItem(STORAGE_KEY, 'true');
      }}
    >
      <SpaceBetween size="xs">
        <Box>
          <strong>Step 1:</strong> Upload a PDF document to get started.
        </Box>
        <Box>
          <strong>Step 2:</strong> Our AI advisor will ask targeted questions to understand your document processing needs.
        </Box>
        <Box>
          <strong>Step 3:</strong> Preview extraction results across multiple methods (Haiku, Nova, Sonnet) and compare quality, speed, and cost.
        </Box>
        <Box>
          <strong>Step 4:</strong> Build an optimized processing pipeline and generate architecture recommendations with deployment code.
        </Box>
      </SpaceBetween>
    </Alert>
  );
}
