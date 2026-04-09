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
import type { UploadResponse, Capability, ProcessorResult, ComparisonResult } from '@idp/shared';
import { METHOD_INFO, CAPABILITY_INFO } from '@idp/shared';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import { marked } from 'marked';
import { authedFetch } from '../services/api.js';
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
  documentLanguages?: string[];
  onViewArchitecture: () => void;
  onPipelineComplete?: (results: ProcessorResult[], comparison: ComparisonResult) => void;
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
  documentLanguages,
  onViewArchitecture,
  onPipelineComplete,
}: PipelinePageProps) {
  const {
    pipeline,
    alternatives,
    nodeStates,
    activeEdges,
    isGenerating,
    isExecuting,
    executionComplete,
    completionData,
    error,
    totalCost,
    totalLatencyMs,
    generatePipeline,
    executePipeline,
    switchPipeline,
    stopExecution,
  } = usePipeline();

  // Notify parent when pipeline execution completes with results
  useEffect(() => {
    if (executionComplete && completionData && onPipelineComplete) {
      onPipelineComplete(completionData.processorResults, completionData.comparison);
    }
  }, [executionComplete, completionData, onPipelineComplete]);

  const [smartRec, setSmartRec] = useState<SmartRecommendation | null>(null);
  const [isSmartGenerating, setIsSmartGenerating] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);

  // Smart generation: use LLM to analyze preview results and generate pipeline
  const generateSmartPipeline = useCallback(async (strategy?: 'accuracy' | 'cost' | 'speed' | 'balanced') => {
    if (!document || capabilities.length === 0) return;

    setIsSmartGenerating(true);
    setSmartError(null);

    try {
      const res = await authedFetch('/api/pipeline/smart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilities,
          documentType: document.documentType ?? 'pdf',
          previewResults: previewData?.results ?? [],
          preferredMethod,
          optimizeFor: strategy ?? 'balanced',
          documentLanguages,
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
          documentLanguages,
        }).catch(() => {});
      }
    } finally {
      setIsSmartGenerating(false);
    }
  }, [document, capabilities, previewData, preferredMethod, documentLanguages, switchPipeline, generatePipeline]);

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
          documentLanguages,
        }).catch(() => {});
      }
    }
  }, [document, capabilities, pipeline, isGenerating, isSmartGenerating, previewData, generateSmartPipeline, generatePipeline]);

  const handleGenerate = useCallback(
    (optimizeFor: 'accuracy' | 'cost' | 'speed' | 'balanced', enableHybrid: boolean) => {
      if (!document || !document.documentType) return;
      if (previewData) {
        // Use smart pipeline (LLM-based) when preview data available
        generateSmartPipeline(optimizeFor);
      } else {
        generatePipeline({
          documentType: document.documentType,
          capabilities,
          optimizeFor,
          enableHybridRouting: enableHybrid,
          documentLanguages,
        }).catch(() => {});
      }
    },
    [document, capabilities, previewData, documentLanguages, generateSmartPipeline, generatePipeline],
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
              <ColumnLayout columns={2} variant="text-grid">
                <div>
                  <Box variant="awsui-key-label">Optimization Strategy</Box>
                  <Box>
                    <StatusIndicator type="info">
                      {smartRec.optimizeFor.charAt(0).toUpperCase() + smartRec.optimizeFor.slice(1)}
                    </StatusIndicator>
                    {smartRec.enableHybridRouting && (
                      <span style={{ marginLeft: '12px', fontSize: '13px', color: '#5f6b7a' }}>Hybrid routing enabled</span>
                    )}
                  </Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Estimated Savings</Box>
                  <Box fontSize="body-s" color="text-body-secondary">{smartRec.estimatedSavings}</Box>
                </div>
              </ColumnLayout>

              <Box fontSize="body-s" color="text-body-secondary">
                <div
                  className="chat-markdown"
                  dangerouslySetInnerHTML={{
                    __html: marked.parse(smartRec.rationale) as string,
                  }}
                  style={{ lineHeight: '1.5' }}
                />
              </Box>

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

        {/* Execution Summary */}
        {executionComplete && completionData && (
          <Container
            header={
              <Header
                variant="h2"
                actions={
                  <Button variant="primary" onClick={onViewArchitecture} iconName="external">
                    View Architecture & Code
                  </Button>
                }
              >
                Execution Complete
              </Header>
            }
          >
            <ColumnLayout columns={4} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">Total Cost</Box>
                <Box variant="awsui-value-large" color="text-status-success">
                  ${totalCost.toFixed(4)}
                </Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Total Latency</Box>
                <Box variant="awsui-value-large">
                  {(totalLatencyMs / 1000).toFixed(1)}s
                </Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Methods</Box>
                <Box variant="awsui-value-large">
                  <StatusIndicator type="success">
                    {completionData.processorResults.filter(r => r.status === 'complete').length} succeeded
                  </StatusIndicator>
                </Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Recommendation</Box>
                <Box>{completionData.comparison.recommendation}</Box>
              </div>
            </ColumnLayout>
          </Container>
        )}

        {/* Extraction Results */}
        {executionComplete && completionData && completionData.processorResults.some(r => r.status === 'complete') && (
          <Container
            header={
              <Header variant="h2">
                Extraction Results
              </Header>
            }
          >
            <Tabs
              tabs={completionData.processorResults
                .filter(r => r.status === 'complete')
                .map(r => {
                  const info = METHOD_INFO[r.method];
                  return {
                    id: r.method,
                    label: `${info?.shortName ?? r.method} ($${r.metrics.cost.toFixed(4)}, ${(r.metrics.latencyMs / 1000).toFixed(1)}s)`,
                    content: (
                      <SpaceBetween size="m">
                        {Object.entries(r.results).map(([capId, capResult]) => {
                          const capInfo = CAPABILITY_INFO[capId as keyof typeof CAPABILITY_INFO];
                          const dataStr = typeof capResult.data === 'string'
                            ? capResult.data
                            : JSON.stringify(capResult.data, null, 2);
                          return (
                            <ExpandableSection
                              key={capId}
                              headerText={`${capInfo?.name ?? capId} (${Math.round(capResult.confidence * 100)}%)`}
                              defaultExpanded={Object.keys(r.results).length <= 3}
                            >
                              <pre style={{
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                fontSize: '13px',
                                lineHeight: '1.5',
                                maxHeight: '400px',
                                overflow: 'auto',
                                background: '#f2f3f3',
                                padding: '12px',
                                borderRadius: '8px',
                                margin: 0,
                              }}>
                                {dataStr}
                              </pre>
                            </ExpandableSection>
                          );
                        })}
                      </SpaceBetween>
                    ),
                  };
                })
              }
            />
          </Container>
        )}

        {/* Alternatives */}
        {pipeline && alternatives.length > 0 && !executionComplete && (
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
