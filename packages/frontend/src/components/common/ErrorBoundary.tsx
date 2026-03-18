import { Component, type ReactNode } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box padding="xl">
          <Alert
            type="error"
            header={this.props.fallbackMessage ?? 'Something went wrong'}
            action={
              <Button onClick={this.handleRetry}>Retry</Button>
            }
          >
            <SpaceBetween size="xs">
              <Box>{this.state.error?.message ?? 'An unexpected error occurred.'}</Box>
              <Box color="text-body-secondary" fontSize="body-s">
                If this persists, try refreshing the page.
              </Box>
            </SpaceBetween>
          </Alert>
        </Box>
      );
    }
    return this.props.children;
  }
}
