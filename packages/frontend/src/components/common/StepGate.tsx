import { useNavigate } from 'react-router-dom';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { FileUp } from 'lucide-react';

interface StepGateProps {
  /** What the user still needs to do, e.g. "Upload a document to analyze it." */
  message: string;
  /** Label for the primary action. Defaults to "Upload a document". */
  actionLabel?: string;
  /** Where the primary action goes. Defaults to the upload step. */
  actionHref?: string;
  /**
   * Heading above the message. Defaults to the "prerequisite missing" wording;
   * override it when the situation is not a missing prerequisite (e.g. a 404,
   * where "Nothing to show yet" would misdescribe the problem).
   */
  heading?: string;
}

/**
 * Shown when a workflow step is opened before its prerequisites exist.
 *
 * Replaces the bare `<Alert type="warning">Please go back to the Upload step</Alert>`
 * that four pages each re-implemented. A dead end that only tells the user to go
 * back is a worse experience than one that takes them there, so this always
 * renders the action that unblocks them.
 */
export default function StepGate({
  message,
  actionLabel = 'Upload a document',
  actionHref = '/',
  heading = 'Nothing to show yet',
}: StepGateProps) {
  const navigate = useNavigate();

  return (
    <Container>
      <Box padding={{ vertical: 'xxxl', horizontal: 'l' }} textAlign="center">
        <SpaceBetween size="m" alignItems="center">
          <Box color="text-status-inactive">
            <FileUp size={40} strokeWidth={1.25} aria-hidden="true" />
          </Box>
          <Box variant="h3" color="text-body-secondary">{heading}</Box>
          <Box color="text-body-secondary" fontSize="body-m">{message}</Box>
          <Button variant="primary" onClick={() => navigate(actionHref)}>
            {actionLabel}
          </Button>
        </SpaceBetween>
      </Box>
    </Container>
  );
}
