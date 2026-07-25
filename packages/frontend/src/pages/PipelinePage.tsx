import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
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
import { METHOD_INFO, CAPABILITY_INFO, WORKFLOW_STEPS, stepSubtitle} from '@idp/shared';
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
import StepGate from '../components/common/StepGate';
import ResultBlock from '../components/common/ResultBlock';
import { token } from '../theme/tokens';

interface PipelinePageProps {
  document: UploadResponse | null;
  capabilities: Capability[];
  previewData: PreviewResponse | null;
  preferredMethod?: string;
  documentLanguages?: string[];
  onViewArchitecture: () => void;
  onPipelineComplete?: (
    results: ProcessorResult[],
    comparison: ComparisonResult,
    pipeline: import('@idp/shared').PipelineDefinition | null,
    preferredMethod?: string,
    runId?: string | null,
  ) => void;
}

interface SmartRecommendation {
  optimizeFor: string;
  enableHybridRouting: boolean;
  methodAssignments: Record<string, string>;
  rationale: string;
  estimatedSavings: string;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

/** This page IS step 3. */
const STEP = WORKFLOW_STEPS[2];

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
    runId,
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
      onPipelineComplete(
        completionData.processorResults,
        completionData.comparison,
        pipeline ?? null,
        preferredMethod,
        runId,
      );
    }
  }, [executionComplete, completionData, onPipelineComplete, pipeline, preferredMethod, runId]);

  // Show a "Final result" tab only when the pipeline actually aggregated across
  // more than one method — with a single method its tab already IS the result.
  const hasAggregatedResults = !!completionData
    && Object.keys(completionData.results ?? {}).length > 0
    && completionData.processorResults.filter((r) => r.status === 'complete').length > 1;

  /**
   * Canvas legend, derived from the nodes this pipeline actually has.
   *
   * The legend was previously a fixed list of six stages, so a single-method
   * pipeline still advertised "Classify — route by content type" and
   * "Aggregate — merge results" even though neither node existed on the canvas
   * and neither ran. Describing stages that are not there is the same class of
   * problem as the decorative classifier node itself.
   */
  const stageLegend = useMemo(() => {
    if (!pipeline) return [];
    const has = (type: string) => pipeline.nodes.some((n) => n.type === type);
    const methodCount = pipeline.nodes.filter((n) => n.type === 'method').length;
    const legend: Array<{ label: string; desc: string }> = [];
    if (has('document-input')) legend.push({ label: 'Input', desc: 'document ingestion' });
    if (has('page-classifier')) legend.push({ label: 'Classify', desc: 'route pages by content type' });
    if (has('sequential-composer')) {
      legend.push({ label: 'Extract → Redact', desc: 'output of one stage feeds the next' });
    } else if (methodCount > 0) {
      legend.push({
        label: 'Methods',
        desc: methodCount > 1 ? `${methodCount} models run in parallel` : 'model extraction',
      });
    }
    if (has('aggregator')) legend.push({ label: 'Aggregate', desc: 'pick the best answer per capability' });
    if (has('pipeline-output')) legend.push({ label: 'Output', desc: 'structured JSON' });
    return legend;
  }, [pipeline]);

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

      content += '\n\n> **Note:** Confidence scores are self-reported by each model and may not reflect actual extraction accuracy. Review the raw results in Step 2 to judge quality yourself.';
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
      <ContentLayout header={<Header variant="h1">{STEP.title}</Header>}>
        <StepGate message={STEP.gate} />
      </ContentLayout>
    );
  }

  if (capabilities.length === 0) {
    return (
      <ContentLayout header={<Header variant="h1">{STEP.title}</Header>}>
        <StepGate
          message={`Select at least one capability in ${WORKFLOW_STEPS[1].title} to build a pipeline.`}
          actionLabel={`Go to ${WORKFLOW_STEPS[1].title}`}
          actionHref="/conversation"
        />
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={stepSubtitle(STEP.href, document.fileName)}
        >
          {STEP.title}
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

        {/*
          Nothing generated and nothing in flight. This state was silent — the
          auto-generate effect needs document.documentType, and a run loaded from
          Recent Runs had none, so step 3 rendered an empty page with no canvas,
          no error and no spinner. The document type is now derived on load, and
          this is the visible backstop with a way forward.
        */}
        {!pipeline && !isGenerating && !isSmartGenerating && !error && !smartError && (
          <Container>
            <Box padding={{ vertical: 'l' }} textAlign="center">
              <SpaceBetween size="s" alignItems="center">
                <Box variant="h3" color="text-body-secondary">No pipeline yet</Box>
                <Box color="text-body-secondary">
                  A pipeline has not been built for this document.
                </Box>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (!document.documentType) return;
                    generatePipeline({
                      documentType: document.documentType,
                      capabilities,
                      optimizeFor: 'balanced',
                      enableHybridRouting: true,
                      documentLanguages,
                    }).catch(() => {});
                  }}
                  disabled={!document.documentType}
                >
                  Build pipeline
                </Button>
              </SpaceBetween>
            </Box>
          </Container>
        )}

        {/* Main layout: Chat + Canvas */}
        {pipeline && (
          <Grid
            gridDefinition={[
              // Split at `m`: the 260px side nav pushes the content area below
              // the `l` breakpoint on a 1440px laptop, which silently stacked
              // these columns instead of showing them side by side.
              { colspan: { default: 12, m: 5 } },
              { colspan: { default: 12, m: 7 } },
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

                {/*
                  Legend for the canvas above. Only lists stages this pipeline
                  actually contains — it used to hard-code all six regardless, so a
                  simple single-method pipeline claimed to have a Classify and an
                  Aggregate stage that were not on the canvas and never ran.
                */}
                <div
                  style={{
                    display: 'flex',
                    gap: 20,
                    flexWrap: 'wrap',
                    fontSize: 13,
                    color: token.textSecondary,
                  }}
                >
                  {stageLegend.map((stage, i) => (
                    <span key={stage.label}>
                      <strong style={{ color: token.text }}>{`${i + 1}. ${stage.label}`}</strong>
                      {` — ${stage.desc}`}
                    </span>
                  ))}
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
              tabs={[
                // "Final result" first: when an Aggregator resolved competing
                // answers, the user's actual output is the merged set, not any
                // single method's tab. Previously only per-method tabs existed,
                // so the pipeline's real output was never shown directly.
                ...(hasAggregatedResults ? [{
                  id: '__final__',
                  label: `Final result (${Object.keys(completionData.results).length})`,
                  content: (
                    <SpaceBetween size="m">
                      <Box color="text-body-secondary" fontSize="body-s">
                        One answer per capability, selected across all methods by the
                        pipeline&apos;s aggregation strategy.
                      </Box>
                      {Object.entries(completionData.results).map(([capId, capResult]) => {
                        const capInfo = CAPABILITY_INFO[capId as keyof typeof CAPABILITY_INFO];
                        const src = (capResult as { sourceMethod?: string }).sourceMethod;
                        const alts = (capResult as { alternativeMethods?: string[] }).alternativeMethods ?? [];
                        const dataStr = typeof capResult.data === 'string'
                          ? capResult.data
                          : JSON.stringify(capResult.data, null, 2);
                        return (
                          <ExpandableSection
                            key={capId}
                            headerText={`${capInfo?.name ?? capId} (${Math.round(capResult.confidence * 100)}%)`}
                            headerDescription={
                              src
                                ? `Selected from ${METHOD_INFO[src as keyof typeof METHOD_INFO]?.shortName ?? src}${
                                    alts.length ? ` · ${alts.length} other method${alts.length > 1 ? 's' : ''} also answered` : ''
                                  }`
                                : undefined
                            }
                            defaultExpanded={Object.keys(completionData.results).length <= 3}
                          >
                            <ResultBlock>{dataStr}</ResultBlock>
                          </ExpandableSection>
                        );
                      })}
                    </SpaceBetween>
                  ),
                }] : []),
                ...completionData.processorResults
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
                              <ResultBlock>{dataStr}</ResultBlock>
                            </ExpandableSection>
                          );
                        })}
                      </SpaceBetween>
                    ),
                  };
                }),
              ]}
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
