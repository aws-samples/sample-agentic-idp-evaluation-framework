import { useCallback, useEffect, useMemo, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Grid from '@cloudscape-design/components/grid';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Table from '@cloudscape-design/components/table';
import Spinner from '@cloudscape-design/components/spinner';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import type { UploadResponse, Capability } from '@idp/shared';
import { METHOD_INFO, getBestMethodsForCapability, CAPABILITY_INFO } from '@idp/shared';
import ChatPanel from '../components/conversation/ChatPanel';
import CapabilityCards from '../components/conversation/CapabilityCards';
import PreviewComparison from '../components/conversation/PreviewComparison';
import { useConversation } from '../hooks/useConversation';
import { usePreview, type PreviewResponse } from '../hooks/usePreview';

interface ConversationPageProps {
  document: UploadResponse | null;
  selectedCapabilities: Capability[];
  onCapabilitiesSelected: (caps: Capability[]) => void;
  onStartProcessing: (preferredMethod?: string, preview?: PreviewResponse | null) => void;
}

export default function ConversationPage({
  document,
  selectedCapabilities,
  onCapabilitiesSelected,
  onStartProcessing,
}: ConversationPageProps) {
  const { messages, recommendations, ambiguity, isStreaming, error, sendMessage } = useConversation(
    document?.documentId ?? null,
    document?.s3Uri,
  );

  const { preview, isLoading: isPreviewLoading, error: previewError, runPreview } = usePreview();
  const [selectedMethod, setSelectedMethod] = useState<string>('');

  // Initialize selected capabilities from recommendations
  useEffect(() => {
    if (recommendations && selectedCapabilities.length === 0) {
      const caps = recommendations
        .filter((r) => r.relevance >= 0.5)
        .map((r) => r.capability);
      onCapabilitiesSelected(caps);
    }
  }, [recommendations, selectedCapabilities.length, onCapabilitiesSelected]);

  const handleToggleCapability = useCallback(
    (cap: Capability, enabled: boolean) => {
      if (enabled) {
        onCapabilitiesSelected([...selectedCapabilities, cap]);
      } else {
        onCapabilitiesSelected(selectedCapabilities.filter((c) => c !== cap));
      }
    },
    [selectedCapabilities, onCapabilitiesSelected],
  );

  const handleRunPreview = useCallback(() => {
    if (!document || selectedCapabilities.length === 0) return;
    runPreview(document.documentId, document.s3Uri, selectedCapabilities);
  }, [document, selectedCapabilities, runPreview]);

  const handleBuildPipeline = useCallback(() => {
    onStartProcessing(selectedMethod || undefined, preview);
  }, [onStartProcessing, selectedMethod, preview]);

  // Build pricing estimate for selected capabilities
  const pricingEstimate = useMemo(() => {
    if (selectedCapabilities.length === 0) return null;

    const capMethodMap: { capability: string; bestMethod: string; family: string; pricing: string }[] = [];
    const uniqueMethods = new Set<string>();

    for (const cap of selectedCapabilities) {
      const methods = getBestMethodsForCapability(cap);
      const best = methods[0];
      const info = METHOD_INFO[best];
      uniqueMethods.add(best);

      let pricing: string;
      if (info.family === 'bda') {
        pricing = `$${info.estimatedCostPerPage}/page`;
      } else if (info.family === 'textract-llm') {
        pricing = `$0.0015/pg + $${info.tokenPricing.inputPer1MTokens}/$${info.tokenPricing.outputPer1MTokens} MTok`;
      } else {
        pricing = `$${info.tokenPricing.inputPer1MTokens} / $${info.tokenPricing.outputPer1MTokens} per 1M tokens`;
      }

      capMethodMap.push({
        capability: CAPABILITY_INFO[cap]?.name ?? cap,
        bestMethod: info.shortName,
        family: info.family,
        pricing,
      });
    }

    return { items: capMethodMap, uniqueMethodCount: uniqueMethods.size };
  }, [selectedCapabilities]);

  if (!document) {
    return (
      <ContentLayout header={<Header variant="h1">Document Analysis</Header>}>
        <Alert type="warning" header="No document uploaded">
          Please go back to the Upload step and upload a document first.
        </Alert>
      </ContentLayout>
    );
  }

  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif)$/i.test(document.fileName);

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={`Analyzing: ${document.fileName} (${document.pageCount} pages)`}
          actions={
            selectedCapabilities.length > 0 ? (
              <SpaceBetween direction="horizontal" size="s">
                {!preview && !isPreviewLoading && (
                  <Button onClick={handleRunPreview}>
                    Run Quick Preview ({selectedCapabilities.length} capabilities)
                  </Button>
                )}
                <Button variant="primary" onClick={handleBuildPipeline}>
                  Build Pipeline
                </Button>
              </SpaceBetween>
            ) : undefined
          }
        >
          Document Analysis
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Grid
          gridDefinition={[
            { colspan: { default: 12, l: 7 } },
            { colspan: { default: 12, l: 5 } },
          ]}
        >
          {/* Chat Panel */}
          <ChatPanel
            messages={messages}
            isStreaming={isStreaming}
            error={error}
            onSendMessage={sendMessage}
          />

          {/* Document Preview */}
          <Container
            header={
              <Box variant="h3" padding={{ top: 'xs', bottom: 'xs' }}>
                Document Preview
              </Box>
            }
          >
            {isImage ? (
              <div style={{ maxHeight: '500px', overflow: 'auto', textAlign: 'center' }}>
                <img
                  src={document.previewUrl}
                  alt={document.fileName}
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </div>
            ) : (
              <div style={{ height: '500px', overflow: 'auto' }}>
                <iframe
                  src={document.previewUrl}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  title="Document preview"
                />
              </div>
            )}
            <Box textAlign="center" padding={{ top: 'xs' }} color="text-body-secondary" fontSize="body-s">
              {document.fileName} | {document.pageCount} pages | {(document.fileSize / 1024).toFixed(1)} KB
            </Box>
          </Container>
        </Grid>

        {/* Ambiguity Status */}
        {ambiguity && (
          <Container
            header={
              <Header variant="h2" description={
                ambiguity.passed
                  ? 'Analysis complete. Ambiguity below 20% threshold. Ready to select capabilities.'
                  : 'Continue the conversation to reduce ambiguity below 20%.'
              }>
                Interview Progress — {100 - ambiguity.overall}% Clear
              </Header>
            }
          >
            <SpaceBetween size="s">
              <ProgressBar
                value={100 - ambiguity.overall}
                status={ambiguity.passed ? 'success' : 'in-progress'}
                resultText={ambiguity.passed ? 'Ready for recommendations' : `${ambiguity.overall}% ambiguity remaining`}
              />
              <ColumnLayout columns={3} variant="text-grid">
                {Object.entries(ambiguity.scores).map(([key, value]) => {
                  const labels: Record<string, string> = {
                    document_type: 'Document Type',
                    processing_goal: 'Processing Goal',
                    volume: 'Volume & Frequency',
                    accuracy: 'Accuracy Needs',
                    fields: 'Target Fields',
                    integration: 'Output Integration',
                  };
                  return (
                    <div key={key}>
                      <Box variant="awsui-key-label">{labels[key] ?? key}</Box>
                      <ProgressBar
                        value={100 - value}
                        status={value === 0 ? 'success' : value < 50 ? 'in-progress' : 'error'}
                        resultText={value === 0 ? 'Resolved' : `${value}% unclear`}
                      />
                    </div>
                  );
                })}
              </ColumnLayout>
            </SpaceBetween>
          </Container>
        )}

        {/* Capability Recommendations */}
        {recommendations && (
          <CapabilityCards
            recommendations={recommendations}
            selected={selectedCapabilities}
            onToggle={handleToggleCapability}
          />
        )}

        {/* Pricing Estimate */}
        {pricingEstimate && !preview && (
          <Container
            header={
              <Header
                variant="h2"
                description="Estimated cost based on recommended methods. Run Quick Preview to compare actual extraction results."
                actions={
                  <Button onClick={handleRunPreview} loading={isPreviewLoading}>
                    Run Quick Preview
                  </Button>
                }
              >
                Processing Cost Estimate
              </Header>
            }
          >
            <SpaceBetween size="m">
              <ColumnLayout columns={2} variant="text-grid">
                <div>
                  <Box variant="awsui-key-label">Selected Capabilities</Box>
                  <Box variant="awsui-value-large">{selectedCapabilities.length}</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Unique Methods Required</Box>
                  <Box variant="awsui-value-large">{pricingEstimate.uniqueMethodCount}</Box>
                </div>
              </ColumnLayout>

              <Table
                columnDefinitions={[
                  { id: 'capability', header: 'Capability', cell: (item) => item.capability },
                  { id: 'method', header: 'Recommended Method', cell: (item) => item.bestMethod },
                  { id: 'family', header: 'Family', cell: (item) => item.family },
                  { id: 'pricing', header: 'Pricing', cell: (item) => item.pricing },
                ]}
                items={pricingEstimate.items}
                variant="embedded"
                stripedRows
              />

              <Box color="text-body-secondary" fontSize="body-s">
                Pricing is per 1M tokens (input/output) for LLM methods, per page for BDA.
                Actual cost depends on document size and token count.
                Run Quick Preview to see actual token usage and real costs.
              </Box>
            </SpaceBetween>
          </Container>
        )}

        {/* Preview Loading */}
        {isPreviewLoading && (
          <Container>
            <Box textAlign="center" padding="xxl">
              <Spinner size="large" />
              <Box padding={{ top: 's' }}>
                Running extraction with 3 methods in parallel...
              </Box>
              <Box color="text-body-secondary" fontSize="body-s" padding={{ top: 'xs' }}>
                Haiku 4.5, Nova 2 Lite, Sonnet 4.6 — comparing extraction quality, speed, and cost
              </Box>
            </Box>
          </Container>
        )}

        {/* Preview Error */}
        {previewError && (
          <Alert type="error" header="Preview failed">
            {previewError}
          </Alert>
        )}

        {/* Preview Results Comparison */}
        {preview && (
          <PreviewComparison
            preview={preview}
            selectedMethod={selectedMethod}
            onMethodSelect={setSelectedMethod}
            onBuildPipeline={handleBuildPipeline}
          />
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
