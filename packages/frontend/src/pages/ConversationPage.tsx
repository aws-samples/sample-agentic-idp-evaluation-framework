import { useCallback, useEffect, useRef, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Grid from '@cloudscape-design/components/grid';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import type { UploadResponse, Capability } from '@idp/shared';
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
  onDocumentLanguagesDetected?: (languages: string[]) => void;
}

export default function ConversationPage({
  document,
  selectedCapabilities,
  onCapabilitiesSelected,
  onStartProcessing,
  onDocumentLanguagesDetected,
}: ConversationPageProps) {
  const { messages, recommendations, documentLanguages, isStreaming, error, sendMessage } = useConversation(
    document?.documentId ?? null,
    document?.s3Uri,
  );

  const { preview, isLoading: isPreviewLoading, error: previewError, runPreview } = usePreview();
  const [selectedMethod, setSelectedMethod] = useState<string>('');

  const autoPreviewDone = useRef(false);

  // Build user instruction from interview conversation to pass to preview adapters
  const userInstruction = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n')
    .trim() || undefined;

  useEffect(() => {
    if (recommendations && selectedCapabilities.length === 0) {
      const caps = recommendations
        .filter((r) => r.relevance >= 0.5)
        .map((r) => r.capability);
      onCapabilitiesSelected(caps);
    }
  }, [recommendations, selectedCapabilities.length, onCapabilitiesSelected]);

  // Pass detected languages up to parent for pipeline filtering
  useEffect(() => {
    if (documentLanguages && onDocumentLanguagesDetected) {
      onDocumentLanguagesDetected(documentLanguages);
    }
  }, [documentLanguages, onDocumentLanguagesDetected]);

  // Auto-run preview once when capabilities are first selected from recommendations
  useEffect(() => {
    if (
      document &&
      selectedCapabilities.length > 0 &&
      recommendations &&
      !preview &&
      !isPreviewLoading &&
      !autoPreviewDone.current
    ) {
      autoPreviewDone.current = true;
      runPreview(document.documentId, document.s3Uri, selectedCapabilities, userInstruction, documentLanguages ?? undefined);
    }
  }, [document, selectedCapabilities, recommendations, preview, isPreviewLoading, runPreview, userInstruction]);

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
    runPreview(document.documentId, document.s3Uri, selectedCapabilities, userInstruction, documentLanguages ?? undefined);
  }, [document, selectedCapabilities, runPreview, userInstruction, documentLanguages]);

  const handleBuildPipeline = useCallback(() => {
    onStartProcessing(selectedMethod || undefined, preview);
  }, [onStartProcessing, selectedMethod, preview]);

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
  const isPdf = /\.pdf$/i.test(document.fileName);
  const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(document.fileName);
  const isAudio = /\.(mp3|wav|flac|m4a|ogg)$/i.test(document.fileName);

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
            hideQuickReplies={!!recommendations || (!!preview && preview.results.some((r) => r.status === 'complete'))}
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
            ) : isPdf ? (
              <div style={{ height: '500px', overflow: 'auto' }}>
                <iframe
                  src={document.previewUrl}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  title="Document preview"
                />
              </div>
            ) : isVideo ? (
              <div style={{ textAlign: 'center' }}>
                <video
                  src={document.previewUrl}
                  controls
                  style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: 8 }}
                />
              </div>
            ) : isAudio ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', background: '#f2f3f3', borderRadius: 8 }}>
                <Box variant="h3" color="text-body-secondary" padding={{ bottom: 's' }}>
                  {document.fileName.split('.').pop()?.toUpperCase()} Audio
                </Box>
                <audio src={document.previewUrl} controls style={{ width: '100%' }} />
              </div>
            ) : (
              <div style={{ height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f2f3f3', borderRadius: 8 }}>
                <Box variant="h3" color="text-body-secondary">{document.fileName.split('.').pop()?.toUpperCase()}</Box>
                <Box padding={{ top: 'xs' }} color="text-body-secondary" fontSize="body-s">
                  Preview not available for this file type.
                </Box>
                <Box padding={{ top: 's' }}>
                  <Button href={document.previewUrl} target="_blank" iconName="external" variant="normal">
                    Download Original
                  </Button>
                </Box>
              </div>
            )}
            <Box textAlign="center" padding={{ top: 'xs' }} color="text-body-secondary" fontSize="body-s">
              {document.fileName} | {document.pageCount} pages | {(document.fileSize / 1024).toFixed(1)} KB
            </Box>
          </Container>
        </Grid>

        {/* Ambiguity tracking is internal only — not shown to users */}

        {/* Capability Recommendations + Preview Button */}
        {recommendations && (
          <CapabilityCards
            recommendations={recommendations}
            selected={selectedCapabilities}
            onToggle={handleToggleCapability}
            onRunPreview={handleRunPreview}
            isPreviewLoading={isPreviewLoading}
            preview={preview}
          />
        )}

        {/* Preview Error */}
        {previewError && (
          <Alert type="error" header="Preview failed">
            {previewError}
          </Alert>
        )}

        {/* All methods failed */}
        {preview && !previewError && preview.results.every((r) => r.status === 'error') && (
          <Alert type="warning" header="All preview methods failed">
            {preview.results.map((r) => `${r.shortName}: ${r.error ?? 'Unknown error'}`).join(' | ')}
          </Alert>
        )}

        {/* Preview Results Comparison — only show after ALL methods complete */}
        {preview && !isPreviewLoading && preview.results.some((r) => r.status === 'complete') && (
          <>
            <PreviewComparison
              preview={preview}
              selectedMethod={selectedMethod}
              onMethodSelect={setSelectedMethod}
              onBuildPipeline={handleBuildPipeline}
            />

            {/* Prominent Build Pipeline CTA */}
            <Container>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                <div>
                  <Box variant="h3">Ready to build your pipeline</Box>
                  <Box color="text-body-secondary">
                    Preview analyzed your document with {preview.results.filter(r => r.status === 'complete').length} methods.
                    Build an optimized pipeline for production use.
                  </Box>
                </div>
                <Button variant="primary" onClick={handleBuildPipeline} iconName="angle-right">
                  Build Pipeline
                </Button>
              </div>
            </Container>
          </>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
