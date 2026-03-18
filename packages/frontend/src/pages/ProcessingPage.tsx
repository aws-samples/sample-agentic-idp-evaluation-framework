import { useState, useCallback, useEffect } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import Grid from '@cloudscape-design/components/grid';
import Toggle from '@cloudscape-design/components/toggle';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Badge from '@cloudscape-design/components/badge';
import type { UploadResponse, Capability, ProcessingMethod, ProcessorResult, ComparisonResult, MethodFamily } from '@idp/shared';
import { METHODS, METHOD_INFO, METHOD_FAMILIES, getMethodsByFamily } from '@idp/shared';
import MethodCard from '../components/processing/MethodCard';
import ComparisonTable from '../components/processing/ComparisonTable';
import MetricsChart from '../components/processing/MetricsChart';
import { useProcessing } from '../hooks/useProcessing';

interface ProcessingPageProps {
  document: UploadResponse | null;
  capabilities: Capability[];
  onComplete: (results: ProcessorResult[], comparison: ComparisonResult) => void;
  onViewArchitecture: () => void;
}

export default function ProcessingPage({
  document,
  capabilities,
  onComplete,
  onViewArchitecture,
}: ProcessingPageProps) {
  const [selectedMethods, setSelectedMethods] = useState<ProcessingMethod[]>([...METHODS]);
  const { methodProgress, comparison, allComplete, finalResults, isRunning, startProcessing } =
    useProcessing();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (allComplete && finalResults.length > 0 && comparison) {
      onComplete(finalResults, comparison);
    }
  }, [allComplete, finalResults, comparison, onComplete]);

  const handleToggleMethod = useCallback((method: ProcessingMethod, checked: boolean) => {
    setSelectedMethods((prev) =>
      checked ? [...prev, method] : prev.filter((m) => m !== method),
    );
  }, []);

  const handleStart = useCallback(() => {
    if (!document) return;
    setStarted(true);
    startProcessing(document.documentId, document.s3Uri, capabilities, selectedMethods);
  }, [document, capabilities, selectedMethods, startProcessing]);

  if (!document) {
    return (
      <ContentLayout header={<Header variant="h1">Processing</Header>}>
        <Alert type="warning" header="No document uploaded">
          Please go back to the Upload step and upload a document first.
        </Alert>
      </ContentLayout>
    );
  }

  if (capabilities.length === 0) {
    return (
      <ContentLayout header={<Header variant="h1">Processing</Header>}>
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
          description={`Processing ${document.fileName} with ${capabilities.length} capabilities`}
          actions={
            allComplete ? (
              <Button variant="primary" onClick={onViewArchitecture}>
                View Architecture Recommendation
              </Button>
            ) : undefined
          }
        >
          Processing & Comparison
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/* Method Selection */}
        {!started && (
          <Container
            header={
              <Header
                variant="h2"
                description="Select which processing methods to run and compare"
                counter={`(${selectedMethods.length} of ${METHODS.length})`}
              >
                Method Selection
              </Header>
            }
          >
            <SpaceBetween size="m">
              {METHOD_FAMILIES.map((family) => {
                const familyMethods = getMethodsByFamily(family);
                const familySelected = familyMethods.filter(m => selectedMethods.includes(m.id as ProcessingMethod)).length;

                const familyNames: Record<MethodFamily, string> = {
                  bda: 'Bedrock Data Automation',
                  claude: 'Claude Models',
                  nova: 'Nova Models',
                  'textract-llm': 'Textract + LLM Hybrid', embeddings: 'Multimodal Embeddings',
                };

                const familyDescriptions: Record<MethodFamily, string> = {
                  bda: 'Automated extraction with standard or custom blueprints',
                  claude: 'Anthropic Claude models via Bedrock Converse API',
                  nova: 'Amazon Nova multimodal models with bounding box support',
                  'textract-llm': 'Amazon Textract OCR combined with LLM structuring', embeddings: 'Nova Multimodal Embeddings for semantic search and RAG',
                };

                return (
                  <ExpandableSection
                    key={family}
                    defaultExpanded
                    headerText={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Box variant="h3">{familyNames[family]}</Box>
                        <Badge color={familySelected > 0 ? 'green' : 'grey'}>
                          {familySelected}/{familyMethods.length} selected
                        </Badge>
                      </div>
                    }
                    headerDescription={familyDescriptions[family]}
                  >
                    <ColumnLayout columns={Math.min(familyMethods.length, 3)} variant="text-grid">
                      {familyMethods.map((methodInfo) => {
                        const method = methodInfo.id as ProcessingMethod;
                        return (
                          <div key={method}>
                            <Toggle
                              checked={selectedMethods.includes(method)}
                              onChange={({ detail }) => handleToggleMethod(method, detail.checked)}
                            >
                              <Box variant="awsui-key-label">{methodInfo.shortName}</Box>
                            </Toggle>
                            <Box variant="small" color="text-body-secondary" padding={{ top: 'xxs' }}>
                              {methodInfo.description}
                            </Box>
                            <Box variant="small" color="text-body-secondary" fontWeight="bold">
                              ~${methodInfo.estimatedCostPerPage.toFixed(3)}/page*
                            </Box>
                            <Box variant="small" color="text-status-success">
                              {methodInfo.strengths[0]}
                            </Box>
                          </div>
                        );
                      })}
                    </ColumnLayout>
                  </ExpandableSection>
                );
              })}

              <Button
                variant="primary"
                onClick={handleStart}
                disabled={selectedMethods.length === 0}
              >
                Run {selectedMethods.length} Method{selectedMethods.length !== 1 ? 's' : ''}
              </Button>
            </SpaceBetween>
          </Container>
        )}

        {/* Processing Progress */}
        {started && (
          <SpaceBetween size="l">
            {isRunning && (
              <Alert type="info">
                Processing in progress. Results will stream in real-time as each method completes.
              </Alert>
            )}

            {allComplete && (
              <Alert type="success" header="All methods complete">
                All processing methods have finished. Review the comparison below.
              </Alert>
            )}

            {/* Method Cards */}
            <Grid
              gridDefinition={selectedMethods.map(() => ({
                colspan: { default: 12, s: 6 },
              }))}
            >
              {selectedMethods.map((method) => {
                const prog = methodProgress[method];
                if (!prog) return null;
                return (
                  <MethodCard
                    key={method}
                    progress={prog}
                    capabilities={capabilities}
                  />
                );
              })}
            </Grid>

            {/* Comparison Table */}
            <ComparisonTable comparison={comparison} />

            {/* Metrics Chart */}
            <MetricsChart comparison={comparison} />
          </SpaceBetween>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
