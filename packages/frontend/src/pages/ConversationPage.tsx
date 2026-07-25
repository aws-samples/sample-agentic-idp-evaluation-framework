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
import { isModelBackedCapability } from '@idp/shared';
import ChatPanel from '../components/conversation/ChatPanel';
import CapabilityCards from '../components/conversation/CapabilityCards';
import PreviewComparison from '../components/conversation/PreviewComparison';
import PreviewProgress from '../components/conversation/PreviewProgress';
import { useConversation } from '../hooks/useConversation';
import { usePreview, type PreviewResponse } from '../hooks/usePreview';
import StepGate from '../components/common/StepGate';
import { token } from '../theme/tokens';

interface ConversationPageProps {
  document: UploadResponse | null;
  selectedCapabilities: Capability[];
  onCapabilitiesSelected: (caps: Capability[]) => void;
  onStartProcessing: (preferredMethod?: string, preview?: PreviewResponse | null) => void;
  onDocumentLanguagesDetected?: (languages: string[]) => void;
  /** Preview restored from persisted state, if this document already has one. */
  previewData?: PreviewResponse | null;
  /** Called when a preview run finishes, so the result can be persisted. */
  onPreviewComplete?: (preview: PreviewResponse) => void;
}

export default function ConversationPage({
  document,
  selectedCapabilities,
  onCapabilitiesSelected,
  onStartProcessing,
  onDocumentLanguagesDetected,
  previewData = null,
  onPreviewComplete,
}: ConversationPageProps) {
  const { messages, recommendations, documentLanguages, isStreaming, error, sendMessage } = useConversation(
    document?.documentId ?? null,
    document?.s3Uri,
  );

  // Seed from the persisted preview so a refresh restores results already paid
  // for. Without this the auto-run effect below saw `preview === null` and
  // re-billed every method on every reload of this page.
  const { preview, isLoading: isPreviewLoading, error: previewError, runPreview } = usePreview(previewData);
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
      // Auto-select "Essential" (>=0.90) and "Highly relevant" (>=0.75) capabilities
      // "Useful but not critical" (<0.75) are shown but not pre-selected.
      // Preprocessing capabilities are excluded: pdf_conversion was being
      // auto-selected at 90% relevance and then sent to every LLM, which no
      // model can act on.
      const caps = recommendations
        .filter((r) => r.relevance >= 0.75)
        .map((r) => r.capability)
        .filter(isModelBackedCapability);
      onCapabilitiesSelected(caps);
    }
  }, [recommendations, selectedCapabilities.length, onCapabilitiesSelected]);

  /*
   * Pass detected languages up to the parent, which feeds them to pipeline routing.
   *
   * TWO sources, interview first: the advisor's own analysis when it ran, otherwise
   * the script detected in the preview's extracted text. The second source exists
   * because routing correctness was silently conditional on the interview —
   * `isMethodLanguageCompatible` correctly excludes BDA and Textract+LLM for
   * non-Latin documents, but nothing populated `documentLanguages` when the user
   * clicked "Skip questions", so a Korean document was routed to methods measured at
   * 32-42% recall while Claude and GPT scored 100% on the same page.
   */
  useEffect(() => {
    if (!onDocumentLanguagesDetected) return;
    const fromInterview = documentLanguages?.length ? documentLanguages : null;
    const fromDocument = preview?.detectedLanguages?.length ? preview.detectedLanguages : null;
    const langs = fromInterview ?? fromDocument;
    if (langs) onDocumentLanguagesDetected(langs);
  }, [documentLanguages, preview?.detectedLanguages, onDocumentLanguagesDetected]);

  // Auto-run preview once capabilities exist.
  //
  // This used to also require `recommendations`, which only appear after the
  // advisor finishes its 3-5 question interview. That made "Skip questions" a
  // dead end: it selected capabilities but nothing ran, because there were no
  // recommendations. Capabilities are the real precondition — however they were
  // chosen.
  useEffect(() => {
    if (
      document &&
      selectedCapabilities.length > 0 &&
      !preview &&
      !isPreviewLoading &&
      !autoPreviewDone.current
    ) {
      autoPreviewDone.current = true;
      runPreview(document.documentId, document.s3Uri, selectedCapabilities, userInstruction, documentLanguages ?? undefined);
    }
  }, [document, selectedCapabilities, preview, isPreviewLoading, runPreview, userInstruction, documentLanguages]);

  // Persist a finished preview so a refresh restores it rather than re-running.
  // Guarded on !isPreviewLoading so partial streams are not stored as complete.
  useEffect(() => {
    if (preview && !isPreviewLoading && preview.results.length > 0 && onPreviewComplete) {
      onPreviewComplete(preview);
    }
  }, [preview, isPreviewLoading, onPreviewComplete]);

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

  /**
   * Leave the interview and continue with a sensible default capability set.
   *
   * The advisor is instructed to ask 3-5 questions before recommending, and
   * until it does the page offers no forward action at all — a user who just
   * wants to see the comparison had no way out. These three cover what almost
   * every document evaluation starts with, and the user can adjust them on the
   * capability cards afterwards.
   */
  const handleSkipInterview = useCallback(() => {
    const defaults: Capability[] = ['text_extraction', 'table_extraction', 'kv_extraction'];
    onCapabilitiesSelected(defaults.filter((c) => isModelBackedCapability(c)));
  }, [onCapabilitiesSelected]);

  if (!document) {
    return (
      <ContentLayout header={<Header variant="h1">Document Analysis</Header>}>
        <StepGate message="Upload a document and the AI advisor will analyze its structure and recommend capabilities." />
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
          description={`Step 2 of 4 · ${document.fileName} · ${document.pageCount} page${document.pageCount === 1 ? '' : 's'}`}
          actions={
            selectedCapabilities.length > 0 ? (
              <SpaceBetween direction="horizontal" size="s">
                {!preview && !isPreviewLoading && (
                  <Button onClick={handleRunPreview}>
                    Run quick preview ({selectedCapabilities.length} capabilities)
                  </Button>
                )}
                {/*
                  Only offer "Build pipeline" here while there is no comparison on
                  screen. Once preview results exist, the comparison component owns
                  that action — having both meant two primary buttons for one action,
                  with different labels, visible at the same time.
                */}
                {!preview && !isPreviewLoading && (
                  <Button variant="primary" onClick={handleBuildPipeline}>
                    Build pipeline
                  </Button>
                )}
              </SpaceBetween>
            ) : (
              // Before the advisor finishes its interview there was NO action at
              // all, so the only way forward was to keep answering questions
              // (the prompt asks for 3-5 exchanges) with no indication of how
              // many remained. Offer an explicit escape hatch.
              <Button onClick={handleSkipInterview} disabled={isStreaming}>
                Skip questions, use defaults
              </Button>
            )
          }
        >
          Document Analysis
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/*
          Split at `m`, not `l`. The side navigation consumes 260px, so on a
          1440px laptop the content area fell short of the `l` breakpoint and
          this Grid silently stacked — pushing the document preview a full
          screen below the chat. `m` keeps chat and preview side by side at
          normal laptop widths and still stacks on genuinely narrow screens.
        */}
        <Grid
          gridDefinition={[
            { colspan: { default: 12, m: 7 } },
            { colspan: { default: 12, m: 5 } },
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
              <div style={{ maxHeight: 'calc(100vh - 380px)', minHeight: '300px', overflow: 'auto', textAlign: 'center' }}>
                <img
                  src={document.previewUrl}
                  alt={document.fileName}
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </div>
            ) : isPdf ? (
              <div style={{ height: 'calc(100vh - 380px)', minHeight: '300px', overflow: 'auto' }}>
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
              // Token-based surfaces: these placeholder panels hardcoded #f2f3f3,
              // which stayed light in dark mode with light text on top of it.
              <div style={{ padding: '40px 20px', textAlign: 'center', background: token.surfaceMuted, borderRadius: 8 }}>
                <Box variant="h3" color="text-body-secondary" padding={{ bottom: 's' }}>
                  {document.fileName.split('.').pop()?.toUpperCase()} Audio
                </Box>
                <audio src={document.previewUrl} controls style={{ width: '100%' }} />
              </div>
            ) : (
              <div style={{ height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: token.surfaceMuted, borderRadius: 8 }}>
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

        {/*
          Live fan-out progress.

          Rendered as soon as the run starts, so each method is visibly resolving
          while the run is in flight. Previously nothing appeared until EVERY
          method had finished, which made a genuinely parallel 16s run (fastest
          method 7s) look like 16 seconds of nothing happening.
        */}
        {preview && !previewError && (
          <PreviewProgress preview={preview} isLoading={isPreviewLoading} />
        )}

        {/* All methods failed */}
        {preview && !isPreviewLoading && !previewError
          && preview.results.length > 0
          && preview.results.every((r) => r.status === 'error') && (
          <Alert type="warning" header="All preview methods failed">
            {preview.results.map((r) => `${r.shortName}: ${r.error ?? 'Unknown error'}`).join(' | ')}
          </Alert>
        )}

        {/*
          Comparison appears once ANY method has succeeded, rather than waiting for
          all of them, and streams in additional columns as the rest land.

          The separate "Ready to build your pipeline" CTA container that used to sit
          below this was removed: the same Build Pipeline button already exists in
          the page header AND in this component's own header, so the action appeared
          three times on one screen with three different labels.
        */}
        {preview && preview.results.some((r) => r.status === 'complete') && (
          <div className="idp-stream-in">
            <PreviewComparison
              preview={preview}
              selectedMethod={selectedMethod}
              onMethodSelect={setSelectedMethod}
              onBuildPipeline={handleBuildPipeline}
              isStreaming={isPreviewLoading}
            />
          </div>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
