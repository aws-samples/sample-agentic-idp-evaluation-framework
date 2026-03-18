import { useEffect, useCallback, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Spinner from '@cloudscape-design/components/spinner';
import type { UploadResponse, Capability } from '@idp/shared';
import { marked } from 'marked';
import PipelineCanvas from '../components/pipeline/PipelineCanvas';
import PipelineToolbar from '../components/pipeline/PipelineToolbar';
import PipelineAlternatives from '../components/pipeline/PipelineAlternatives';
import { usePipeline } from '../hooks/usePipeline';
import type { PreviewResponse } from '../hooks/usePreview';

interface PipelinePageProps {
  document: UploadResponse | null;
  capabilities: Capability[];
  previewData: PreviewResponse | null;
  preferredMethod?: string;
  onViewArchitecture: () => void;
}

interface SmartRecommendation {
  optimizeFor: string;
  enableHybridRouting: boolean;
  methodAssignments: Record<string, string>;
  rationale: string;
  estimatedSavings: string;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export default function PipelinePage({
  document,
  capabilities,
  previewData,
  preferredMethod,
  onViewArchitecture,
}: PipelinePageProps) {
  const {
    pipeline,
    alternatives,
    nodeStates,
    activeEdges,
    isGenerating,
    isExecuting,
    error,
    generatePipeline,
    executePipeline,
    switchPipeline,
    stopExecution,
  } = usePipeline();

  const [smartRec, setSmartRec] = useState<SmartRecommendation | null>(null);
  const [isSmartGenerating, setIsSmartGenerating] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);

  // Smart generation: use LLM to analyze preview results and generate pipeline
  const generateSmartPipeline = useCallback(async () => {
    if (!document || capabilities.length === 0) return;

    setIsSmartGenerating(true);
    setSmartError(null);

    try {
      const res = await fetch('/api/pipeline/smart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilities,
          documentType: document.documentType ?? 'pdf',
          previewResults: previewData?.results ?? [],
          preferredMethod,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Smart generation failed (${res.status})`);
      }

      const data = await res.json();

      // Set the pipeline from the smart response
      if (data.pipeline) {
        // Use the usePipeline's generatePipeline won't work here since we already have the result
        // We need to manually set it via switchPipeline
        switchPipeline(data.pipeline);
      }
      if (data.alternatives) {
        // Store alternatives - they come from the standard generator
      }
      if (data.smartRecommendation) {
        setSmartRec(data.smartRecommendation);
      }
    } catch (err) {
      setSmartError(err instanceof Error ? err.message : 'Unknown error');
      // Fallback to standard generation
      if (document.documentType) {
        generatePipeline({
          documentType: document.documentType,
          capabilities,
          optimizeFor: 'balanced',
          enableHybridRouting: false,
        }).catch(() => {});
      }
    } finally {
      setIsSmartGenerating(false);
    }
  }, [document, capabilities, previewData, preferredMethod, switchPipeline, generatePipeline]);

  // Auto-generate on mount
  useEffect(() => {
    if (document && capabilities.length > 0 && !pipeline && !isGenerating && !isSmartGenerating) {
      if (previewData) {
        // Smart generation with preview data
        generateSmartPipeline();
      } else if (document.documentType) {
        // Fallback to standard generation
        generatePipeline({
          documentType: document.documentType,
          capabilities,
          optimizeFor: 'balanced',
          enableHybridRouting: true,
        }).catch(() => {});
      }
    }
  }, [document, capabilities, pipeline, isGenerating, isSmartGenerating, previewData, generateSmartPipeline, generatePipeline]);

  const handleGenerate = useCallback(
    (optimizeFor: 'accuracy' | 'cost' | 'speed' | 'balanced', enableHybrid: boolean) => {
      if (!document || !document.documentType) return;
      generatePipeline({
        documentType: document.documentType,
        capabilities,
        optimizeFor,
        enableHybridRouting: enableHybrid,
      }).catch(() => {});
    },
    [document, capabilities, generatePipeline],
  );

  const handleExecute = useCallback(() => {
    if (!pipeline || !document || !document.s3Uri) return;
    executePipeline(pipeline, document.documentId, document.s3Uri);
  }, [pipeline, document, executePipeline]);

  const handleExport = useCallback(() => {
    if (!pipeline) return;
    const dataStr = JSON.stringify({ pipeline, smartRecommendation: smartRec }, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `pipeline-${pipeline.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [pipeline, smartRec]);

  const handleSwitchPipeline = useCallback(
    (newPipeline: typeof pipeline) => {
      if (newPipeline) switchPipeline(newPipeline);
    },
    [switchPipeline],
  );

  if (!document) {
    return (
      <ContentLayout header={<Header variant="h1">Pipeline Builder</Header>}>
        <Alert type="warning" header="No document uploaded">
          Please go back to the Upload step and upload a document first.
        </Alert>
      </ContentLayout>
    );
  }

  if (capabilities.length === 0) {
    return (
      <ContentLayout header={<Header variant="h1">Pipeline Builder</Header>}>
        <Alert type="warning" header="No capabilities selected">
          Please go back to the Analyze step and select at least one capability.
        </Alert>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={`Optimized processing pipeline for ${document.fileName}`}
          actions={
            pipeline ? (
              <Button variant="primary" onClick={onViewArchitecture}>
                Generate Code
              </Button>
            ) : undefined
          }
        >
          Pipeline Builder
        </Header>
      }
    >
      <SpaceBetween size="l">
        {(error || smartError) && (
          <Alert type="error" header="Pipeline Error" dismissible onDismiss={() => {}}>
            {error || smartError}
          </Alert>
        )}

        {/* Smart Generation Loading */}
        {isSmartGenerating && (
          <Container>
            <Box textAlign="center" padding="xxl">
              <Spinner size="large" />
              <Box padding={{ top: 's' }} variant="h3">
                AI is analyzing your preview results...
              </Box>
              <Box color="text-body-secondary" padding={{ top: 'xs' }}>
                Claude is reviewing the extraction results from 3 methods and building an optimal pipeline
                for your {capabilities.length} selected capabilities.
              </Box>
            </Box>
          </Container>
        )}

        {/* AI Recommendation */}
        {smartRec && (
          <Container
            header={
              <Header variant="h2" description="Based on actual extraction preview results">
                AI Pipeline Recommendation
              </Header>
            }
          >
            <SpaceBetween size="m">
              <ColumnLayout columns={3} variant="text-grid">
                <div>
                  <Box variant="awsui-key-label">Optimization Strategy</Box>
                  <Box variant="awsui-value-large">
                    {smartRec.optimizeFor.charAt(0).toUpperCase() + smartRec.optimizeFor.slice(1)}
                  </Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Hybrid Routing</Box>
                  <Box variant="awsui-value-large">
                    {smartRec.enableHybridRouting ? 'Enabled' : 'Disabled'}
                  </Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Estimated Savings</Box>
                  <Box variant="awsui-value-large">{smartRec.estimatedSavings}</Box>
                </div>
              </ColumnLayout>

              <div
                className="chat-markdown"
                dangerouslySetInnerHTML={{
                  __html: marked.parse(smartRec.rationale) as string,
                }}
                style={{ fontSize: '14px', lineHeight: '1.6', color: '#16191f' }}
              />

              {smartRec.tokenUsage && (
                <Box color="text-body-secondary" fontSize="body-s">
                  Pipeline analysis: {smartRec.tokenUsage.inputTokens} input + {smartRec.tokenUsage.outputTokens} output tokens
                </Box>
              )}
            </SpaceBetween>
          </Container>
        )}

        {/* Toolbar */}
        {!isSmartGenerating && (
          <PipelineToolbar
            pipeline={pipeline}
            isGenerating={isGenerating}
            isExecuting={isExecuting}
            onGenerate={handleGenerate}
            onExecute={handleExecute}
            onExport={handleExport}
          />
        )}

        {isGenerating && (
          <Alert type="info">Generating pipeline configuration...</Alert>
        )}

        {/* Pipeline Canvas */}
        {pipeline && (
          <Container
            header={
              <Header variant="h2" description={pipeline.description}>
                {pipeline.name}
              </Header>
            }
          >
            <SpaceBetween size="m">
              <ColumnLayout columns={4} variant="text-grid">
                <div>
                  <Box variant="awsui-key-label">Estimated Cost</Box>
                  <Box variant="awsui-value-large">${pipeline.estimatedCostPerPage.toFixed(4)}/page</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Estimated Latency</Box>
                  <Box variant="awsui-value-large">{pipeline.estimatedLatencyMs}ms</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Pipeline Nodes</Box>
                  <Box variant="awsui-value-large">{pipeline.nodes.length}</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Capabilities</Box>
                  <Box variant="awsui-value-large">{capabilities.length}</Box>
                </div>
              </ColumnLayout>

              <PipelineCanvas
                pipeline={pipeline}
                nodeStates={nodeStates}
                activeEdges={activeEdges}
                fileName={document.fileName}
              />

              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '13px', color: '#5f6b7a' }}>
                <span><strong>1. Input</strong> - Document ingestion</span>
                <span><strong>2. Classify</strong> - Route by content type</span>
                <span><strong>3. Capabilities</strong> - What to extract</span>
                <span><strong>4. Methods</strong> - AI model selection</span>
                <span><strong>5. Aggregate</strong> - Merge results</span>
                <span><strong>6. Output</strong> - Structured JSON</span>
              </div>
            </SpaceBetween>
          </Container>
        )}

        {/* Alternatives */}
        {pipeline && alternatives.length > 0 && (
          <PipelineAlternatives
            alternatives={alternatives}
            currentPipeline={pipeline}
            onSwitch={handleSwitchPipeline}
            disabled={isExecuting}
          />
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
