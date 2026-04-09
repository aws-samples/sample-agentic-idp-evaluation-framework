import { useEffect, useCallback, useState, useRef } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Grid from '@cloudscape-design/components/grid';
import Spinner from '@cloudscape-design/components/spinner';
import type { UploadResponse, Capability, ProcessorResult, ComparisonResult } from '@idp/shared';
import { METHOD_INFO, CAPABILITY_INFO } from '@idp/shared';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import { authedFetch } from '../services/api.js';
import ChatPanel from '../components/conversation/ChatPanel';
import PipelineCanvas from '../components/pipeline/PipelineCanvas';
import PipelineAlternatives from '../components/pipeline/PipelineAlternatives';
import { usePipeline } from '../hooks/usePipeline';
import { usePipelineChat } from '../hooks/usePipelineChat';
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

  // Pipeline chat for conversational modification
  const {
    messages: chatMessages,
    isStreaming: isChatStreaming,
    error: chatError,
    pipelineUpdate,
    sendMessage: sendChatMessage,
    addInitialMessage,
  } = usePipelineChat(
    pipeline,
    capabilities,
    document?.documentType ?? 'pdf',
    documentLanguages,
  );

  // Notify parent when pipeline execution completes with results
  useEffect(() => {
    if (executionComplete && completionData && onPipelineComplete) {
      onPipelineComplete(completionData.processorResults, completionData.comparison);
    }
  }, [executionComplete, completionData, onPipelineComplete]);

  const [smartRec, setSmartRec] = useState<SmartRecommendation | null>(null);
  const [isSmartGenerating, setIsSmartGenerating] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);
  const initialMessageSent = useRef(false);

  // Smart generation: use LLM to analyze preview results and generate pipeline
  const generateSmartPipeline = useCallback(async () => {
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
          optimizeFor: 'balanced',
          documentLanguages,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Smart generation failed (${res.status})`);
      }

      const data = await res.json();

      if (data.pipeline) {
        switchPipeline(data.pipeline, data.alternatives ?? []);
      }
      if (data.smartRecommendation) {
        setSmartRec(data.smartRecommendation);
      }
    } catch (err) {
      setSmartError(err instanceof Error ? err.message : 'Unknown error');
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
        generateSmartPipeline();
      } else if (document.documentType) {
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

  // Add initial chat message when pipeline is first generated
  useEffect(() => {
    if (pipeline && !initialMessageSent.current) {
      initialMessageSent.current = true;

      const methodNodes = pipeline.nodes.filter((n) => n.type === 'method');
      const methodNames = methodNodes.map((n) => n.label).join(', ');

      let content = `I've built a **${pipeline.name}** using **${methodNames}**.\n\n`;
      content += `- Est. cost: **$${pipeline.estimatedCostPerPage.toFixed(4)}/page**\n`;
      content += `- Est. latency: **${pipeline.estimatedLatencyMs}ms**\n`;
      content += `- Capabilities: **${capabilities.length}** across **${methodNodes.length}** method(s)\n`;

      if (smartRec?.rationale) {
        content += `\n${smartRec.rationale}`;
      }

      content += '\n\nHow would you like to modify this pipeline?';

      addInitialMessage({
        role: 'assistant',
        content,
        quickReplies: ['Optimize for cost', 'Optimize for accuracy', 'Use fastest methods', 'Explain method choices'],
      });
    }
  }, [pipeline, smartRec, capabilities, addInitialMessage]);

  // Apply pipeline updates from chat
  useEffect(() => {
    if (pipelineUpdate) {
      switchPipeline(pipelineUpdate.pipeline, pipelineUpdate.alternatives);
    }
  }, [pipelineUpdate, switchPipeline]);

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

  const handleChatSend = useCallback(
    (message: string) => {
      if (isExecuting) return;
      sendChatMessage(message);
    },
    [isExecuting, sendChatMessage],
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
                Claude is reviewing the extraction results and building an optimal pipeline
                for your {capabilities.length} selected capabilities.
              </Box>
            </Box>
          </Container>
        )}

        {isGenerating && (
          <Alert type="info">Generating pipeline configuration...</Alert>
        )}

        {/* Main layout: Chat + Canvas */}
        {pipeline && (
          <Grid
            gridDefinition={[
              { colspan: { default: 12, l: 5 } },
              { colspan: { default: 12, l: 7 } },
            ]}
          >
            {/* Chat Panel */}
            <ChatPanel
              messages={chatMessages}
              isStreaming={isChatStreaming}
              error={chatError}
              onSendMessage={handleChatSend}
              title="Pipeline Chat"
              placeholder="Ask to modify the pipeline..."
            />

            {/* Pipeline Canvas + Actions */}
            <Container
              header={
                <Header
                  variant="h2"
                  description={pipeline.description}
                  actions={
                    <SpaceBetween direction="horizontal" size="s">
                      <Button
                        iconName="download"
                        onClick={handleExport}
                        disabled={isExecuting}
                      >
                        Export
                      </Button>
                      <Button
                        variant="primary"
                        onClick={handleExecute}
                        loading={isExecuting}
                        disabled={isGenerating || isExecuting}
                        iconName="caret-right-filled"
                      >
                        Execute Pipeline
                      </Button>
                    </SpaceBetween>
                  }
                >
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
          </Grid>
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
