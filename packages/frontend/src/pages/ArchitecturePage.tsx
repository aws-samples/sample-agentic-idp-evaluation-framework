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
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import type {
  UploadResponse,
  Capability,
  ProcessorResult,
  ComparisonResult,
  PipelineDefinition,
} from '@idp/shared';
import type { ProcessingMethod } from '@idp/shared';
import { CAPABILITY_INFO, METHOD_INFO, WORKFLOW_STEPS, stepSubtitle} from '@idp/shared';
import { marked } from 'marked';
import { useArchitecture } from '../hooks/useArchitecture';
import { useCodeGen } from '../hooks/useCodeGen';
import MermaidDiagram from '../components/common/MermaidDiagram';
import { token } from '../theme/tokens';
import SafeHtml from '../components/common/SafeHtml';
import StepGate from '../components/common/StepGate';
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
  generateCdkTsConfig,
  generateReadme,
} from './architectureTemplates';

interface ArchitecturePageProps {
  document: UploadResponse | null;
  processingResults: ProcessorResult[];
  comparison: ComparisonResult | null;
  capabilities: Capability[];
  executedPipeline?: PipelineDefinition | null;
  selectedPipelineMethod?: string;
}


/**
 * The generated project, grouped by what the user is trying to do rather than by
 * file. `aiGenerated` marks the files an LLM writes; the rest are fixed manifests
 * and entry points that are identical in every bundle, so tagging them "(AI)"
 * would have been noise.
 */
type FileKey =
  | 'readme' | 'python' | 'requirements' | 'typescript' | 'tsPkg'
  | 'cdkStack' | 'cdkLambda' | 'cdkApp' | 'cdkPkg' | 'cdkJson' | 'cdkTsConfig' | 'pipelineConfig';

interface GeneratedFile {
  key: FileKey;
  name: string;
  language: string;
  /** Whether this file comes from the AI bundle, so the label can say so. */
  aiGenerated?: boolean;
}

const FILE_GROUPS: Array<{
  id: string;
  label: string;
  hint: string;
  files: GeneratedFile[];
}> = [
  {
    id: 'overview',
    label: 'Read me first',
    hint: 'What this project does, how to run it, and which methods it was generated from.',
    files: [
      { key: 'readme', name: 'README.md', language: 'markdown' },
      { key: 'pipelineConfig', name: 'pipeline.json', language: 'json' },
    ],
  },
  {
    id: 'python',
    label: 'Python',
    hint: 'A runnable script plus its dependencies. Start here for a quick local test.',
    files: [
      { key: 'python', name: 'process.py', language: 'python', aiGenerated: true },
      { key: 'requirements', name: 'requirements.txt', language: 'text' },
    ],
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    hint: 'The same processing logic for a Node.js project.',
    files: [
      { key: 'typescript', name: 'process.ts', language: 'typescript', aiGenerated: true },
      { key: 'tsPkg', name: 'package.json', language: 'json' },
    ],
  },
  {
    id: 'deploy',
    label: 'Deploy (CDK)',
    hint: 'A complete CDK app: S3, Lambda and least-privilege IAM. `cdk deploy` as-is.',
    files: [
      { key: 'cdkStack', name: 'lib/idp-stack.ts', language: 'typescript', aiGenerated: true },
      { key: 'cdkLambda', name: 'lambda/processor.ts', language: 'typescript', aiGenerated: true },
      { key: 'cdkApp', name: 'bin/idp.ts', language: 'typescript' },
      { key: 'cdkPkg', name: 'package.json', language: 'json' },
      { key: 'cdkJson', name: 'cdk.json', language: 'json' },
      { key: 'cdkTsConfig', name: 'tsconfig.json', language: 'json' },
    ],
  },
];

const TOTAL_GENERATED_FILES = FILE_GROUPS.reduce((n, g) => n + g.files.length, 0);

/**
 * Where each file lands in the downloaded ZIP. The tab labels are relative names.
 *
 * `process.ts` is deliberately written TWICE — once at the root as the standalone
 * Node.js entry point, and once inside `cdk/` next to the Lambda that imports it.
 * The generated Lambda does `import { processDocument } from '../process.js'`, and
 * CDK's NodejsFunction bundles from `cdk/lambda/processor.ts`, so that specifier
 * resolves to `cdk/process.js`. With one copy at the ZIP root only, `cdk deploy`
 * failed at bundling with an unresolved import — the generated project could not
 * build at all, which is the worst possible outcome for a "deployable as-is" artifact.
 */
const ZIP_PATHS: Record<FileKey, string> = {
  readme: 'README.md',
  pipelineConfig: 'pipeline.json',
  python: 'process.py',
  requirements: 'requirements.txt',
  typescript: 'process.ts',
  tsPkg: 'package.json',
  cdkStack: 'cdk/lib/idp-stack.ts',
  cdkLambda: 'cdk/lambda/processor.ts',
  cdkApp: 'cdk/bin/idp.ts',
  cdkPkg: 'cdk/package.json',
  cdkJson: 'cdk/cdk.json',
  cdkTsConfig: 'cdk/tsconfig.json',
};

/**
 * Extra copies of a generated file, keyed by the primary file it duplicates.
 * Kept as data (rather than a special case in the zip loop) so the reason a file is
 * duplicated stays next to the path that needs it.
 */
const ZIP_EXTRA_COPIES: Partial<Record<FileKey, string[]>> = {
  // Resolves `../process.js` from cdk/lambda/processor.ts.
  typescript: ['cdk/process.ts'],
};

/**
 * Files whose extra copy needs DIFFERENT content from the original.
 *
 * `cdk/process.ts` is the same pipeline module as the root `process.ts`, minus the CLI
 * entry point: that shim uses top-level `await` and `import.meta.url`, which are ESM-only.
 * The root project is ESM (`"type": "module"`), but the CDK app compiles as CommonJS, and
 * tsc rejects both there — three errors that stopped the generated CDK project building.
 */
const ZIP_COPY_OVERRIDES: Record<string, (args: CodeGenArgs) => string> = {
  'cdk/process.ts': (a) => generateTypeScriptCode(a.capabilities, a.processingResults, a.comparison, a.executedPipeline, { cli: false }),
};

interface CodeGenArgs {
  capabilities: Capability[];
  processingResults: ProcessorResult[];
  comparison?: ComparisonResult | null;
  executedPipeline?: PipelineDefinition | null;
}

/** This page IS step 4. */
const STEP = WORKFLOW_STEPS[3];

export default function ArchitecturePage({
  document,
  processingResults,
  comparison,
  capabilities,
  executedPipeline = null,
  selectedPipelineMethod,
}: ArchitecturePageProps) {
  const { text: aiText, diagram, costProjections, isLoading: aiLoading, error: aiError, generate } = useArchitecture();
  const { code: aiCode, isGenerating: codeGenLoading, generateCode } = useCodeGen();
  const aiGenerated = useRef(false);
  const codeGenTriggered = useRef(false);
  const [activeGroup, setActiveGroup] = useState(FILE_GROUPS[0].id);

  // Auto-generate AI recommendation when we have processing results
  useEffect(() => {
    if (processingResults.length > 0 && !aiGenerated.current) {
      aiGenerated.current = true;
      generate({
        capabilities,
        processingResults,
        comparison,
        pipeline: executedPipeline,
        selectedMethod: selectedPipelineMethod,
      });
    }
  }, [processingResults, capabilities, comparison, executedPipeline, selectedPipelineMethod, generate]);

  // Auto-generate AI code after architecture recommendation loads
  useEffect(() => {
    if (aiText && !aiLoading && !codeGenTriggered.current && processingResults.length > 0) {
      codeGenTriggered.current = true;
      // Build capability→method map from the executed pipeline's method nodes
      // so code-gen honors the user's preferred-method choice (e.g. Sonnet)
      // and sequential composer (e.g. Guardrails).
      const pipelineMethods: Record<string, string> = {};
      if (executedPipeline) {
        for (const node of executedPipeline.nodes) {
          if (node.type !== 'method') continue;
          const method = (node.config as any).method as string | undefined;
          const caps = (node.config as any).capabilities as string[] | undefined;
          if (!method || !caps) continue;
          for (const cap of caps) pipelineMethods[cap] = method;
        }
      }
      generateCode(
        capabilities,
        processingResults,
        comparison,
        Object.keys(pipelineMethods).length > 0 ? pipelineMethods : undefined,
        executedPipeline,
        selectedPipelineMethod,
      );
    }
  }, [aiText, aiLoading, processingResults, capabilities, comparison, executedPipeline, selectedPipelineMethod, generateCode]);

  // Deterministic fallback templates — real, runnable code if AI generation is unavailable.
  const tplPython = useMemo(() => generatePythonCode(capabilities, processingResults, comparison, executedPipeline), [capabilities, processingResults, comparison, executedPipeline]);
  const tplRequirements = useMemo(() => generatePythonRequirements(), []);
  const tplTs = useMemo(() => generateTypeScriptCode(capabilities, processingResults, comparison, executedPipeline), [capabilities, processingResults, comparison, executedPipeline]);
  const tplTsPkg = useMemo(() => generateTypeScriptPackageJson(capabilities, processingResults, comparison, executedPipeline), [capabilities, processingResults, comparison, executedPipeline]);
  const tplCdk = useMemo(() => generateCdkStack(capabilities, processingResults, comparison, executedPipeline), [capabilities, processingResults, comparison, executedPipeline]);
  const tplLambda = useMemo(() => generateCdkLambdaHandler(capabilities, processingResults, comparison, executedPipeline), [capabilities, processingResults, comparison, executedPipeline]);
  const tplCdkApp = useMemo(() => generateCdkAppEntry(), []);
  const tplCdkPkg = useMemo(() => generateCdkPackageJson(capabilities, processingResults, comparison, executedPipeline), [capabilities, processingResults, comparison, executedPipeline]);
  const tplCdkJson = useMemo(() => generateCdkJson(), []);
  const tplCdkTsConfig = useMemo(() => generateCdkTsConfig(), []);
  const tplReadme = useMemo(() => generateReadme(capabilities, processingResults, comparison, executedPipeline), [capabilities, processingResults, comparison, executedPipeline]);

  /**
   * Choose ONE source for the whole bundle.
   *
   * Each file used to fall back independently (`aiCode?.python ?? tplPython`),
   * so a partial LLM response produced a mixed bundle — AI-generated Python
   * sitting next to a template CDK stack that wired up different methods. The
   * files are meant to be one deployable project, so they must all come from the
   * same generator. The AI bundle is used only when it is complete; otherwise the
   * deterministic templates are used in full.
   */
  const aiBundleComplete = !!aiCode
    && !!aiCode.python && !!aiCode.typescript && !!aiCode.cdk && !!aiCode.cdkLambdaHandler;

  const bundle = aiBundleComplete ? aiCode : null;

  const activePython = bundle?.python ?? tplPython;
  const activeRequirements = bundle?.pythonRequirements ?? tplRequirements;
  const activeTs = bundle?.typescript ?? tplTs;
  const activeTsPkg = bundle?.typescriptPackageJson ?? tplTsPkg;
  const activeCdk = bundle?.cdk ?? tplCdk;
  const activeLambda = bundle?.cdkLambdaHandler ?? tplLambda;
  const activeCdkApp = bundle?.cdkAppEntry ?? tplCdkApp;
  const activeCdkPkg = bundle?.cdkPackageJson ?? tplCdkPkg;
  const activeCdkJson = bundle?.cdkJson ?? tplCdkJson;
  const activeReadme = bundle?.readme ?? tplReadme;

  const methodSummary = useMemo(() => {
    const methodMap = buildMethodMap(capabilities, processingResults, comparison, executedPipeline);
    return Array.from(methodMap.entries())
      .map(([method, caps]) => ({
        method,
        info: METHOD_INFO[method as ProcessingMethod],
        capabilities: caps.map(c => CAPABILITY_INFO[c as Capability]?.name ?? c),
      }))
      // Drop methods that are no longer in the catalog.
      //
      // State persists across releases, and runs are re-loadable from DynamoDB, so
      // a stored pipeline can name a method that has since been removed (nova-pro
      // was). `info` was then undefined and the very next line —
      // `m.info.shortName` — threw, blanking the whole Architecture page for a run
      // that is otherwise perfectly readable.
      .filter((m) => !!m.info);
  }, [capabilities, processingResults, comparison, executedPipeline]);

  // Detect sequential composer from the executed pipeline (extract→guardrails).
  const hasSequentialComposer = useMemo(() => {
    return !!executedPipeline?.nodes.some((n) => n.type === 'sequential-composer');
  }, [executedPipeline]);

  /**
   * Per-page cost of the whole architecture, matching how step 3 states it
   * (`pipeline.estimatedCostPerPage`) so the two steps do not disagree on the
   * headline number. Methods run per page, so their fees add.
   */
  const summaryCostPerPage = useMemo(
    () => methodSummary.reduce((sum, m) => sum + m.info.estimatedCostPerPage, 0),
    [methodSummary],
  );

  const pipelineConfigJson = useMemo(() => JSON.stringify({
    capabilities,
    methods: methodSummary.map((m) => ({
      method: m.method,
      model: m.info.name,
      modelId: METHOD_INFO[m.method as ProcessingMethod]?.modelId,
      capabilities: m.capabilities,
      pricing: m.info.tokenPricing,
    })),
  }, null, 2), [capabilities, methodSummary]);

  const fileContents: Record<FileKey, string> = {
    readme: activeReadme,
    python: activePython,
    requirements: activeRequirements,
    typescript: activeTs,
    tsPkg: activeTsPkg,
    cdkStack: activeCdk,
    cdkLambda: activeLambda,
    cdkApp: activeCdkApp,
    cdkPkg: activeCdkPkg,
    cdkJson: activeCdkJson,
    cdkTsConfig: tplCdkTsConfig,
    pipelineConfig: pipelineConfigJson,
  };
  const fileFor = (key: FileKey) => fileContents[key];

  /** Suffix marks provenance, so a template bundle is never presented as AI output. */
  const fileLabel = (file: GeneratedFile) => {
    if (!file.aiGenerated) return file.name;
    if (codeGenLoading) return `${file.name} …`;
    return aiBundleComplete ? `${file.name} (AI)` : file.name;
  };

  if (!document || capabilities.length === 0) {
    return (
      <ContentLayout header={<Header variant="h1">{STEP.title}</Header>}>
        <StepGate message={STEP.gate} />
      </ContentLayout>
    );
  }

  const handleDownloadZip = async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    /*
     * Paths come from ZIP_PATHS keyed by the same FileKey the tabs use, so the
     * download and the viewer cannot drift apart — previously both restated the
     * file list and `pipeline.json` was serialised twice with different content.
     */
    for (const group of FILE_GROUPS) {
      for (const file of group.files) {
        const content = fileFor(file.key);
        zip.file(ZIP_PATHS[file.key], content);
        // Same content at a second path where a generated import expects it — unless
        // that path needs a variant (see ZIP_COPY_OVERRIDES).
        for (const extra of ZIP_EXTRA_COPIES[file.key] ?? []) {
          const override = ZIP_COPY_OVERRIDES[extra];
          zip.file(extra, override
            ? override({ capabilities, processingResults, comparison, executedPipeline })
            : content);
        }
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    /*
     * Named after the document it was generated from rather than `Date.now()`: a folder
     * of `idp-project-1761423...zip` files is unidentifiable, and someone comparing two
     * documents ends up with exactly that.
     */
    const stem = (document?.fileName ?? 'pipeline').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
    a.download = `idp-${stem}-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={`${stepSubtitle(STEP.href, document.fileName)} · a deployable project for ${capabilities.length} capabilit${capabilities.length === 1 ? 'y' : 'ies'}`}
        >
          Architecture & Code Generation
        </Header>
      }
    >
      <SpaceBetween size="l">
        {processingResults.length === 0 && (
          <Alert type="info" header="No pipeline execution data" action={
            <Button href="/pipeline">Go to Pipeline</Button>
          }>
            Run the pipeline first to get AI-powered architecture recommendations based on actual processing results.
          </Alert>
        )}

        {/*
          Leads with the same shape as step 3: a 4-up metric row, then the detail.
          Step 4 used to open with the AI narrative and bury what actually ran in
          the middle of the page, so the two steps read as unrelated screens.
        */}
        <Container
          header={
            <Header
              variant="h2"
              description={
                executedPipeline
                  ? `Reflects the pipeline you executed in Step 3${selectedPipelineMethod ? ` (preferred: ${selectedPipelineMethod})` : ''}${hasSequentialComposer ? ' — sequential composition active' : ''}.`
                  : 'No pipeline executed; showing best-guess from preview comparison.'
              }
            >
              Pipeline Architecture
            </Header>
          }
        >
          <SpaceBetween size="m">
            <ColumnLayout columns={4} variant="text-grid">
              <div>
                {/* Unit in the label — see PipelinePage: "/page" wrapped mid-word here. */}
                <Box variant="awsui-key-label">Estimated cost / page</Box>
                <Box variant="awsui-value-large">${summaryCostPerPage.toFixed(4)}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Methods</Box>
                <Box variant="awsui-value-large">{methodSummary.length}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Capabilities</Box>
                <Box variant="awsui-value-large">{capabilities.length}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Files Generated</Box>
                <Box variant="awsui-value-large">{TOTAL_GENERATED_FILES}</Box>
              </div>
            </ColumnLayout>

            {/*
              `columns` is clamped to 1-4. It used to be passed methodSummary.length
              directly, so a pipeline using 5+ methods handed Cloudscape an
              out-of-range column count, and a pipeline with 0 methods passed 0.
            */}
            {methodSummary.length === 0 ? (
              <Box color="text-body-secondary">
                No processing methods recorded for this run.
              </Box>
            ) : (
              <ColumnLayout
                columns={Math.min(4, Math.max(1, methodSummary.length))}
                variant="text-grid"
              >
                {methodSummary.map((m) => (
                  <div key={m.method}>
                    <Box variant="awsui-key-label">{m.info.shortName}</Box>
                    <Box color="text-body-secondary" fontSize="body-s" padding={{ top: 'xxs' }}>
                      {m.capabilities.join(', ')}
                    </Box>
                    <Box fontSize="body-s" padding={{ top: 'xxs' }}>
                      ${m.info.tokenPricing.inputPer1MTokens}/{m.info.tokenPricing.outputPer1MTokens} per 1M tokens
                    </Box>
                  </div>
                ))}
              </ColumnLayout>
            )}
          </SpaceBetween>
        </Container>

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
                        <SafeHtml
                          key={i}
                          className="chat-markdown"
                          profile="markdown"
                          html={marked.parse(part.content) as string}
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
              {/*
                The AI's own cost projections used to render here as a second table.
                They are now shown inside the single Cost Projection section below,
                next to the calculator, so the page states monthly cost once.
              */}
            </SpaceBetween>
          </Container>
        )}

        {aiError && (
          <Alert type="warning" header="AI recommendation unavailable">
            {aiError}. Showing static code generation below.
          </Alert>
        )}

        {/* Code Tabs */}
        <Container
          header={
            <Header
              variant="h2"
              description={codeGenLoading
                ? 'Generating production-ready code from your benchmark results…'
                : `${aiBundleComplete
                  ? 'AI-generated from your real benchmark data'
                  : 'Generated from your benchmark data'} — ${TOTAL_GENERATED_FILES} files: `
                  + 'a README, the pipeline config, the processing logic in Python and '
                  + 'TypeScript, and a CDK app that deploys it. Download the ZIP and run it as-is.'}
              actions={
                <Button
                  iconName="download"
                  onClick={handleDownloadZip}
                  // Say what is in it before the user commits to a download. The button
                  // previously stated nothing about the contents.
                  ariaLabel={`Download ${TOTAL_GENERATED_FILES} generated files as a ZIP archive`}
                >
                  Download ZIP
                </Button>
              }
            >
              Generated project
            </Header>
          }
        >
          {/*
            Grouped into the four things a user actually chooses between — read me
            first, run it in Python, run it in TypeScript, deploy it — with the
            secondary files of each group behind a sub-tab. A flat 11-tab strip mixed
            `process.py` with `cdk/cdk.json` at the same level, so the five CDK files
            read as five unrelated choices and the strip overflowed on a laptop.
          */}
          <Tabs
            activeTabId={activeGroup}
            onChange={({ detail }) => setActiveGroup(detail.activeTabId)}
            tabs={FILE_GROUPS.map((group) => ({
              id: group.id,
              label: group.label,
              content: (
                <SpaceBetween size="s">
                  <Box color="text-body-secondary" fontSize="body-s">{group.hint}</Box>
                  {group.files.length === 1 ? (
                    <CodeBlock
                      code={fileFor(group.files[0].key)}
                      language={group.files[0].language}
                    />
                  ) : (
                    <Tabs
                      variant="container"
                      tabs={group.files.map((file) => ({
                        id: `${group.id}:${file.key}`,
                        label: fileLabel(file),
                        content: <CodeBlock code={fileFor(file.key)} language={file.language} />,
                      }))}
                    />
                  )}
                </SpaceBetween>
              ),
            }))}
          />
        </Container>

        {/*
          One cost section, not two. The AI cost projection table and this
          calculator both answered "what will this cost per month" with different
          numbers from different models — the AI table from its own estimate, this
          one from estimatedCostPerPage — with nothing saying which to trust. The AI
          projections are now shown here as a comparison row, clearly labelled.
        */}
        <CostProjectionCalculator
          methodSummary={methodSummary}
          aiProjections={costProjections}
        />

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
      {/*
        Kept deliberately dark in BOTH themes: this is source code, and a
        consistently dark editor surface is the convention users expect. Unlike the
        extraction-result blocks, the colours here are a fixed pair with adequate
        contrast (#e8e8e8 on #1a1a2e ≈ 13:1), so they are correct rather than an
        oversight — the token-based surfaces are for UI chrome, not code.
      */}
      <pre style={{
        background: '#1a1a2e',
        color: '#e8e8e8',
        padding: '16px',
        borderRadius: '8px',
        fontFamily: token.fontMono,
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

interface AiCostProjection {
  scale: string;
  docsPerMonth: number;
  methods: Array<{ method: string; monthlyCost: number }>;
}

function CostProjectionCalculator({
  methodSummary,
  aiProjections = [],
}: {
  methodSummary: MethodSummaryItem[];
  aiProjections?: AiCostProjection[];
}) {
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
          trackBy="method"
          variant="embedded"
          stripedRows
          footer={
            <Box textAlign="right" fontWeight="bold" fontSize="heading-s">
              Total estimated monthly cost: ${totalMonthly.toFixed(2)} ({parseInt(docsPerMonth || '0') * parseInt(avgPages || '0')} pages/month)
            </Box>
          }
        />

        {/*
          The AI's independent projection, shown as a second opinion rather than a
          competing table. It answers the same question from a different estimate, so
          presenting it unlabelled beside the calculator invited the reader to assume
          one of them was authoritative.
        */}
        {aiProjections.length > 0 && (
          <ExpandableSection
            headerText="Compare with the AI's own projection"
            headerDescription="Generated from your run, at the scale tiers it chose. Expect it to differ from the calculator above — different assumptions, not a correction."
          >
            <Table
              columnDefinitions={[
                { id: 'scale', header: 'Scale', cell: (item) => item.scale },
                { id: 'docs', header: 'Docs/Month', cell: (item) => item.docsPerMonth.toLocaleString() },
                ...((aiProjections[0]?.methods ?? []).map((m) => ({
                  id: m.method,
                  header: m.method,
                  cell: (item: AiCostProjection) => {
                    const method = item.methods?.find((x) => x.method === m.method);
                    return method ? `$${method.monthlyCost.toFixed(2)}` : '-';
                  },
                }))),
              ]}
              items={aiProjections}
              // Without trackBy, Cloudscape cannot derive a stable React key per row
              // and logs "Each child in a list should have a unique key prop" — the
              // warning that used to appear on this page.
              trackBy="scale"
              variant="embedded"
              stripedRows
            />
          </ExpandableSection>
        )}

        <Alert type="info">
          Estimates use per-page cost approximations. Actual LLM costs depend on token count per document.
          Use the Preview step for precise per-document token usage and cost.
        </Alert>
      </SpaceBetween>
    </Container>
  );
}
