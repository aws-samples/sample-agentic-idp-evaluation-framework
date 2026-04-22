import { useState, useMemo, useEffect, useRef } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import Tabs from '@cloudscape-design/components/tabs';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
import Table from '@cloudscape-design/components/table';
import Spinner from '@cloudscape-design/components/spinner';
import type {
  UploadResponse,
  Capability,
  ProcessorResult,
  ComparisonResult,
} from '@idp/shared';
import type { ProcessingMethod } from '@idp/shared';
import { CAPABILITY_INFO, METHOD_INFO } from '@idp/shared';
import { marked } from 'marked';
import { useArchitecture } from '../hooks/useArchitecture';
import { useCodeGen } from '../hooks/useCodeGen';
import MermaidDiagram from '../components/common/MermaidDiagram';
import {
  buildMethodMap,
  generatePythonCode,
  generatePythonRequirements,
  generateTypeScriptCode,
  generateTypeScriptPackageJson,
  generateCdkStack,
  generateCdkLambdaHandler,
  generateCdkAppEntry,
  generateCdkPackageJson,
  generateCdkJson,
  generateReadme,
} from './architectureTemplates';

interface ArchitecturePageProps {
  document: UploadResponse | null;
  processingResults: ProcessorResult[];
  comparison: ComparisonResult | null;
  capabilities: Capability[];
}


export default function ArchitecturePage({
  document,
  processingResults,
  comparison,
  capabilities,
}: ArchitecturePageProps) {
  const { text: aiText, diagram, costProjections, isLoading: aiLoading, error: aiError, generate } = useArchitecture();
  const { code: aiCode, isGenerating: codeGenLoading, generateCode } = useCodeGen();
  const aiGenerated = useRef(false);
  const codeGenTriggered = useRef(false);

  // Auto-generate AI recommendation when we have processing results
  useEffect(() => {
    if (processingResults.length > 0 && !aiGenerated.current) {
      aiGenerated.current = true;
      generate({ capabilities, processingResults, comparison });
    }
  }, [processingResults, capabilities, comparison, generate]);

  // Auto-generate AI code after architecture recommendation loads
  useEffect(() => {
    if (aiText && !aiLoading && !codeGenTriggered.current && processingResults.length > 0) {
      codeGenTriggered.current = true;
      generateCode(capabilities, processingResults, comparison);
    }
  }, [aiText, aiLoading, processingResults, capabilities, comparison, generateCode]);

  // Deterministic fallback templates — real, runnable code if AI generation is unavailable.
  const tplPython = useMemo(() => generatePythonCode(capabilities, processingResults, comparison), [capabilities, processingResults, comparison]);
  const tplRequirements = useMemo(() => generatePythonRequirements(), []);
  const tplTs = useMemo(() => generateTypeScriptCode(capabilities, processingResults, comparison), [capabilities, processingResults, comparison]);
  const tplTsPkg = useMemo(() => generateTypeScriptPackageJson(), []);
  const tplCdk = useMemo(() => generateCdkStack(capabilities, processingResults, comparison), [capabilities, processingResults, comparison]);
  const tplLambda = useMemo(() => generateCdkLambdaHandler(capabilities, processingResults, comparison), [capabilities, processingResults, comparison]);
  const tplCdkApp = useMemo(() => generateCdkAppEntry(), []);
  const tplCdkPkg = useMemo(() => generateCdkPackageJson(), []);
  const tplCdkJson = useMemo(() => generateCdkJson(), []);
  const tplReadme = useMemo(() => generateReadme(capabilities, processingResults, comparison), [capabilities, processingResults, comparison]);

  const activePython = aiCode?.python ?? tplPython;
  const activeRequirements = aiCode?.pythonRequirements ?? tplRequirements;
  const activeTs = aiCode?.typescript ?? tplTs;
  const activeTsPkg = aiCode?.typescriptPackageJson ?? tplTsPkg;
  const activeCdk = aiCode?.cdk ?? tplCdk;
  const activeLambda = aiCode?.cdkLambdaHandler ?? tplLambda;
  const activeCdkApp = aiCode?.cdkAppEntry ?? tplCdkApp;
  const activeCdkPkg = aiCode?.cdkPackageJson ?? tplCdkPkg;
  const activeCdkJson = aiCode?.cdkJson ?? tplCdkJson;
  const activeReadme = aiCode?.readme ?? tplReadme;

  const methodSummary = useMemo(() => {
    const methodMap = buildMethodMap(capabilities, processingResults, comparison);
    return Array.from(methodMap.entries()).map(([method, caps]) => ({
      method,
      info: METHOD_INFO[method as ProcessingMethod],
      capabilities: caps.map(c => CAPABILITY_INFO[c as Capability]?.name ?? c),
    }));
  }, [capabilities, processingResults]);

  if (!document || capabilities.length === 0) {
    return (
      <ContentLayout header={<Header variant="h1">Architecture & Code</Header>}>
        <Alert type="warning" header="No analysis data">
          Please complete the Upload and Analyze steps first.
        </Alert>
      </ContentLayout>
    );
  }

  const handleDownloadAll = () => {
    // Emit one combined markdown file with every artifact in a file-per-section layout.
    // Each section uses a path-hinted heading so a user can copy-paste into the real project structure.
    const section = (path: string, language: string, body: string) =>
      `\n\n## \`${path}\`\n\n\`\`\`${language}\n${body}\n\`\`\``;
    const content = [
      `# IDP Pipeline Project — Generated by ONE IDP Platform`,
      '',
      `Document: ${document.fileName}`,
      `Generated: ${new Date().toISOString()}`,
      `Capabilities (${capabilities.length}): ${capabilities.join(', ')}`,
      '',
      'Unpack each code block below into the path shown above it. Suggested layout:',
      '',
      '```',
      'idp-project/',
      '├── README.md',
      '├── process.py',
      '├── requirements.txt',
      '├── process.ts',
      '├── package.json',
      '└── cdk/',
      '    ├── cdk.json',
      '    ├── package.json',
      '    ├── bin/idp.ts',
      '    ├── lib/idp-stack.ts',
      '    └── lambda/processor.ts',
      '```',
      section('README.md', 'markdown', activeReadme),
      section('process.py', 'python', activePython),
      section('requirements.txt', 'text', activeRequirements),
      section('process.ts', 'typescript', activeTs),
      section('package.json', 'json', activeTsPkg),
      section('cdk/cdk.json', 'json', activeCdkJson),
      section('cdk/package.json', 'json', activeCdkPkg),
      section('cdk/bin/idp.ts', 'typescript', activeCdkApp),
      section('cdk/lib/idp-stack.ts', 'typescript', activeCdk),
      section('cdk/lambda/processor.ts', 'typescript', activeLambda),
    ].join('\n');

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `idp-project-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={`Production-ready code for processing ${document.fileName} with ${capabilities.length} capabilities`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="download" onClick={handleDownloadAll}>
                Download All Code
              </Button>
            </SpaceBetween>
          }
        >
          Architecture & Code Generation
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/* AI Architecture Recommendation */}
        {(aiLoading || aiText) && (
          <Container
            header={
              <Header
                variant="h2"
                description="AI-generated based on your actual extraction results"
                actions={!aiLoading && aiText ? (
                  <CopyToClipboard
                    copyButtonAriaLabel="Copy as Markdown"
                    copyButtonText="Copy as Markdown"
                    copySuccessText="Copied!"
                    copyErrorText="Failed to copy"
                    textToCopy={aiText
                      .replace(/<diagram>[\s\S]*?<\/diagram>/g, '')
                      .replace(/<costs>[\s\S]*?<\/costs>/g, '')
                      .trim()}
                    variant="button"
                  />
                ) : undefined}
              >
                {aiLoading ? (
                  <span><Spinner size="normal" /> Generating Architecture Recommendation...</span>
                ) : (
                  'Architecture Recommendation'
                )}
              </Header>
            }
          >
            <SpaceBetween size="m">
              {aiText && (() => {
                const cleaned = aiText
                  .replace(/<diagram>[\s\S]*?<\/diagram>/g, '')
                  .replace(/<costs>[\s\S]*?<\/costs>/g, '')
                  .trim();
                // Extract ```mermaid blocks for separate rendering
                const parts: Array<{ type: 'text' | 'mermaid'; content: string }> = [];
                let remaining = cleaned;
                const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
                let match;
                let lastIndex = 0;
                while ((match = mermaidRegex.exec(remaining)) !== null) {
                  if (match.index > lastIndex) {
                    parts.push({ type: 'text', content: remaining.slice(lastIndex, match.index) });
                  }
                  parts.push({ type: 'mermaid', content: match[1].trim() });
                  lastIndex = match.index + match[0].length;
                }
                if (lastIndex < remaining.length) {
                  parts.push({ type: 'text', content: remaining.slice(lastIndex) });
                }
                if (parts.length === 0) parts.push({ type: 'text', content: cleaned });

                return (
                  <SpaceBetween size="m">
                    {parts.map((part, i) =>
                      part.type === 'mermaid' ? (
                        <MermaidDiagram key={i} chart={part.content} />
                      ) : (
                        <div
                          key={i}
                          className="chat-markdown"
                          dangerouslySetInnerHTML={{ __html: marked.parse(part.content) as string }}
                          style={{ fontSize: '14px', lineHeight: '1.6' }}
                        />
                      )
                    )}
                  </SpaceBetween>
                );
              })()}
              {diagram && (
                <div>
                  <Box variant="h3" padding={{ bottom: 'xs' }}>Architecture Diagram</Box>
                  <MermaidDiagram chart={diagram} />
                </div>
              )}
              {costProjections.length > 0 && (
                <Table
                  header={<Header variant="h3">AI Cost Projections</Header>}
                  columnDefinitions={[
                    { id: 'scale', header: 'Scale', cell: (item) => item.scale },
                    { id: 'docs', header: 'Docs/Month', cell: (item) => item.docsPerMonth.toLocaleString() },
                    ...((costProjections[0]?.methods ?? []).map((m) => ({
                      id: m.method,
                      header: m.method,
                      cell: (item: any) => {
                        const method = item.methods?.find((x: any) => x.method === m.method);
                        return method ? `$${method.monthlyCost.toFixed(2)}` : '-';
                      },
                    }))),
                  ]}
                  items={costProjections}
                  variant="embedded"
                  stripedRows
                />
              )}
            </SpaceBetween>
          </Container>
        )}

        {aiError && (
          <Alert type="warning" header="AI recommendation unavailable">
            {aiError}. Showing static code generation below.
          </Alert>
        )}

        {processingResults.length === 0 && (
          <Alert type="info" header="No pipeline execution data" action={
            <Button href="/pipeline">Go to Pipeline</Button>
          }>
            Run the pipeline first to get AI-powered architecture recommendations based on actual processing results.
          </Alert>
        )}

        {/* Architecture Summary */}
        <Container
          header={<Header variant="h2">Pipeline Architecture</Header>}
        >
          <SpaceBetween size="m">
            <ColumnLayout columns={methodSummary.length} variant="text-grid">
              {methodSummary.map((m) => (
                <div key={m.method}>
                  <Box variant="awsui-key-label">{m.info.shortName}</Box>
                  <Box variant="awsui-value-large">{m.capabilities.length} capabilities</Box>
                  <Box color="text-body-secondary" fontSize="body-s" padding={{ top: 'xxs' }}>
                    {m.capabilities.join(', ')}
                  </Box>
                  <Box fontSize="body-s" padding={{ top: 'xxs' }}>
                    ${m.info.tokenPricing.inputPer1MTokens}/{m.info.tokenPricing.outputPer1MTokens} per 1M tokens
                  </Box>
                </div>
              ))}
            </ColumnLayout>

            <Alert type="info">
              Code snippets below are ready to use with Claude Code or Kiro.
              Copy the code, paste it into your project, and run it.
              Each snippet includes the correct Bedrock model IDs, capabilities, and cost tracking.
            </Alert>
          </SpaceBetween>
        </Container>

        {/* Code Tabs */}
        <Container
          header={
            <Header
              variant="h2"
              description={codeGenLoading
                ? 'Generating production-ready code from your benchmark results…'
                : aiCode?.cdk
                  ? 'AI-generated from real benchmark data. Every file below is deployable as-is.'
                  : 'Deterministic template generated from your benchmark data. Deployable as-is.'}
            >
              Generated project
            </Header>
          }
        >
          <Tabs
            tabs={[
              {
                id: 'readme',
                label: 'README.md',
                content: <CodeBlock code={activeReadme} language="markdown" />,
              },
              {
                id: 'python',
                label: codeGenLoading ? 'process.py …' : aiCode?.python ? 'process.py (AI)' : 'process.py',
                content: <CodeBlock code={activePython} language="python" />,
              },
              {
                id: 'requirements',
                label: 'requirements.txt',
                content: <CodeBlock code={activeRequirements} language="text" />,
              },
              {
                id: 'typescript',
                label: codeGenLoading ? 'process.ts …' : aiCode?.typescript ? 'process.ts (AI)' : 'process.ts',
                content: <CodeBlock code={activeTs} language="typescript" />,
              },
              {
                id: 'ts-pkg',
                label: 'package.json',
                content: <CodeBlock code={activeTsPkg} language="json" />,
              },
              {
                id: 'cdk-stack',
                label: codeGenLoading ? 'cdk/lib/idp-stack.ts …' : aiCode?.cdk ? 'cdk/lib/idp-stack.ts (AI)' : 'cdk/lib/idp-stack.ts',
                content: <CodeBlock code={activeCdk} language="typescript" />,
              },
              {
                id: 'cdk-lambda',
                label: 'cdk/lambda/processor.ts',
                content: <CodeBlock code={activeLambda} language="typescript" />,
              },
              {
                id: 'cdk-app',
                label: 'cdk/bin/idp.ts',
                content: <CodeBlock code={activeCdkApp} language="typescript" />,
              },
              {
                id: 'cdk-pkg',
                label: 'cdk/package.json',
                content: <CodeBlock code={activeCdkPkg} language="json" />,
              },
              {
                id: 'cdk-json',
                label: 'cdk/cdk.json',
                content: <CodeBlock code={activeCdkJson} language="json" />,
              },
              {
                id: 'pipeline-config',
                label: 'pipeline.json',
                content: (
                  <CodeBlock
                    code={JSON.stringify({
                      capabilities,
                      methods: methodSummary.map((m) => ({
                        method: m.method,
                        model: m.info.name,
                        modelId: METHOD_INFO[m.method as ProcessingMethod]?.modelId,
                        capabilities: m.capabilities,
                        pricing: m.info.tokenPricing,
                      })),
                      generatedAt: new Date().toISOString(),
                    }, null, 2)}
                    language="json"
                  />
                ),
              },
            ]}
          />
        </Container>

        {/* Cost Projection Calculator (#12) */}
        <CostProjectionCalculator methodSummary={methodSummary} />

        {/* Next Steps */}
        <Container header={<Header variant="h2">Next Steps</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="h3">1. Copy Code</Box>
              <Box color="text-body-secondary">
                Choose Python or TypeScript. The code includes correct model IDs,
                capabilities, and automatic cost calculation from token usage.
              </Box>
            </div>
            <div>
              <Box variant="h3">2. Deploy Infrastructure</Box>
              <Box color="text-body-secondary">
                Use the CDK template to provision S3 buckets, Lambda functions,
                and IAM roles with least-privilege Bedrock access.
              </Box>
            </div>
            <div>
              <Box variant="h3">3. Scale & Monitor</Box>
              <Box color="text-body-secondary">
                Add Step Functions for batch processing, CloudWatch for monitoring,
                and API Gateway for REST endpoints.
              </Box>
            </div>
          </ColumnLayout>
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
        <CopyToClipboard
          copyButtonAriaLabel="Copy code"
          copySuccessText="Copied!"
          copyErrorText="Failed to copy"
          textToCopy={code}
          variant="icon"
        />
      </div>
      <pre style={{
        background: '#1a1a2e',
        color: '#e8e8e8',
        padding: '16px',
        borderRadius: '8px',
        fontSize: '13px',
        lineHeight: '1.5',
        overflow: 'auto',
        maxHeight: '500px',
        margin: 0,
      }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface MethodSummaryItem {
  method: string;
  info: { shortName: string; estimatedCostPerPage: number; tokenPricing: { inputPer1MTokens: number; outputPer1MTokens: number } };
  capabilities: string[];
}

function CostProjectionCalculator({ methodSummary }: { methodSummary: MethodSummaryItem[] }) {
  const [docsPerMonth, setDocsPerMonth] = useState('1000');
  const [avgPages, setAvgPages] = useState('5');

  const projections = useMemo(() => {
    const docs = parseInt(docsPerMonth) || 0;
    const pages = parseInt(avgPages) || 0;
    const totalPages = docs * pages;

    return methodSummary.map((m) => {
      const monthlyCost = m.info.estimatedCostPerPage * totalPages;
      return {
        method: m.info.shortName,
        capabilities: m.capabilities.length,
        costPerPage: `$${m.info.estimatedCostPerPage.toFixed(4)}`,
        monthlyCost: `$${monthlyCost.toFixed(2)}`,
        annualCost: `$${(monthlyCost * 12).toFixed(2)}`,
      };
    });
  }, [methodSummary, docsPerMonth, avgPages]);

  const totalMonthly = projections.reduce((sum, p) => sum + parseFloat(p.monthlyCost.slice(1)), 0);

  return (
    <Container
      header={
        <Header variant="h2" description="Estimate monthly and annual costs based on your document volume">
          Cost Projection
        </Header>
      }
    >
      <SpaceBetween size="m">
        <ColumnLayout columns={2}>
          <FormField label="Documents per month">
            <Input
              type="number"
              value={docsPerMonth}
              onChange={({ detail }) => setDocsPerMonth(detail.value)}
            />
          </FormField>
          <FormField label="Average pages per document">
            <Input
              type="number"
              value={avgPages}
              onChange={({ detail }) => setAvgPages(detail.value)}
            />
          </FormField>
        </ColumnLayout>

        <Table
          columnDefinitions={[
            { id: 'method', header: 'Method', cell: (item) => item.method },
            { id: 'caps', header: 'Capabilities', cell: (item) => item.capabilities },
            { id: 'perPage', header: 'Cost/Page', cell: (item) => item.costPerPage },
            { id: 'monthly', header: 'Monthly', cell: (item) => <Box fontWeight="bold">{item.monthlyCost}</Box> },
            { id: 'annual', header: 'Annual', cell: (item) => item.annualCost },
          ]}
          items={projections}
          variant="embedded"
          stripedRows
          footer={
            <Box textAlign="right" fontWeight="bold" fontSize="heading-s">
              Total estimated monthly cost: ${totalMonthly.toFixed(2)} ({parseInt(docsPerMonth || '0') * parseInt(avgPages || '0')} pages/month)
            </Box>
          }
        />

        <Alert type="info">
          Estimates use per-page cost approximations. Actual LLM costs depend on token count per document.
          Use the Preview step for precise per-document token usage and cost.
        </Alert>
      </SpaceBetween>
    </Container>
  );
}
