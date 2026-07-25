import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Button from '@cloudscape-design/components/button';
import Badge from '@cloudscape-design/components/badge';
import type { UploadResponse } from '@idp/shared';
import {
  CAPABILITIES,
  CATEGORY_INFO,
  CAPABILITY_CATEGORIES,
  getCapabilitiesByCategory,
  METHODS,
  getMethodsByFamily,
} from '@idp/shared';
import type { SupportLevel, MethodFamily } from '@idp/shared';
import Popover from '@cloudscape-design/components/popover';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import {
  Upload,
  MessageSquare,
  GitCompareArrows,
  Award,
} from 'lucide-react';
import DocumentUpload from '../components/upload/DocumentUpload';
import OnboardingBanner from '../components/common/OnboardingBanner';
import { getCapabilityIcon } from '../components/common/icons';
import { useMethodAvailability } from '../hooks/useMethodAvailability';

interface HomePageProps {
  onUploadComplete: (doc: UploadResponse) => void;
}

const FAMILY_NAMES: Record<string, string> = {
  bda: 'Bedrock Data Automation',
  'bda-llm': 'BDA + LLM Hybrid',
  claude: 'Claude (LLM)',
  nova: 'Nova (LLM)',
  gpt: 'OpenAI GPT (LLM)',
  'textract-llm': 'Textract + LLM',
  textract: 'Amazon Textract',
  embeddings: 'Nova Embeddings',
  'nova-embeddings': 'Nova Embeddings',
  comprehend: 'Amazon Comprehend',
  guardrails: 'Bedrock Guardrails',
  'bedrock-guardrails': 'Bedrock Guardrails',
};

/**
 * Families grouped by the ROLE they play, because they are not interchangeable
 * peers. Listing "BDA Standard" and "Bedrock Guardrails" in the same flat grid
 * as "Claude Opus 5" implied you would pick between them, when in practice a
 * managed pipeline, a general-purpose model and a PII policy engine answer
 * different questions.
 */
const FAMILY_GROUPS: ReadonlyArray<{
  title: string;
  blurb: string;
  families: readonly MethodFamily[];
}> = [
  {
    title: 'General-purpose models',
    blurb: 'Multimodal LLMs that read the document directly. Pick these to compare raw model quality.',
    families: ['claude', 'gpt', 'nova'],
  },
  {
    title: 'Managed extraction pipelines',
    blurb: 'AWS-managed OCR and extraction. Lower cost and consistent output, with a fixed schema.',
    families: ['bda'],
  },
  {
    title: 'Two-stage hybrids',
    blurb: 'A managed extractor handles OCR, then an LLM structures the result.',
    families: ['bda-llm', 'textract-llm'],
  },
  {
    title: 'Specialized services',
    blurb: 'Purpose-built for one job rather than general extraction.',
    families: ['guardrails', 'embeddings'],
  },
];

/** Per-family note explaining what the family actually is, where it is not obvious. */
const FAMILY_ROLE_NOTES: Partial<Record<MethodFamily, string>> = {
  guardrails: 'Deterministic PII detection and redaction policy — applies only to PII capabilities, not general extraction.',
  embeddings: 'Produces vectors for search and retrieval, not extracted fields.',
  bda: 'Fully managed extraction service. Requires a data-automation profile.',
};

const STEPS = [
  { icon: <Upload size={24} strokeWidth={1.5} />, title: 'Upload', desc: 'Upload any document — PDF, image, Word, Excel, or PowerPoint.' },
  { icon: <MessageSquare size={24} strokeWidth={1.5} />, title: 'Analyze', desc: 'AI advisor identifies structure and recommends capabilities.' },
  { icon: <GitCompareArrows size={24} strokeWidth={1.5} />, title: 'Compare', desc: 'Run methods in parallel. See cost, speed, and confidence.' },
  { icon: <Award size={24} strokeWidth={1.5} />, title: 'Recommend', desc: 'Get architecture guidance with cost projections at scale.' },
];

export default function HomePage({ onUploadComplete }: HomePageProps) {
  const uploadRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isUnavailable, reasonFor } = useMethodAvailability();

  const handleUploadComplete = (doc: UploadResponse) => {
    onUploadComplete(doc);
    navigate('/conversation');
  };

  const scrollToUpload = () => {
    uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Move focus to the upload control as well. Scrolling alone leaves keyboard
    // and screen-reader users where they were, so the CTA appeared to do nothing.
    uploadRef.current?.querySelector<HTMLElement>('input[type="file"], button')?.focus({
      preventScroll: true,
    });
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Upload a document, compare AWS processing methods side by side, and get architecture guidance with real cost projections."
        >
          IDP Evaluation Framework
        </Header>
      }
    >
      <SpaceBetween size="l">

        {/*
          Hero. The page header already states the product and its purpose, so
          this used to repeat both ("IDP Evaluation Framework" above
          "Find the Right IDP Approach" above a paraphrase of the same
          description) — three stacked headings before any content. It now
          carries only the call to action.
        */}
        <Container>
          <div style={{ textAlign: 'center', padding: '32px 0 24px' }}>
            <SpaceBetween size="m">
              <Box variant="h2" fontSize="display-l">Find the right IDP approach</Box>
              <Box color="text-body-secondary" fontSize="heading-s" padding={{ horizontal: 'xxxl' }}>
                Four steps, roughly a minute per document.
              </Box>
              <div style={{ paddingTop: 8 }}>
                <Button variant="primary" iconName="upload" onClick={scrollToUpload}>
                  Start evaluation
                </Button>
              </div>
            </SpaceBetween>
          </div>
        </Container>

        {/* How It Works */}
        <Container header={<Header variant="h2">How It Works</Header>}>
          <ColumnLayout columns={4} minColumnWidth={200} variant="text-grid">
            {STEPS.map((step, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <SpaceBetween size="xs">
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 48, height: 48, borderRadius: 10,
                    border: '1px solid var(--color-border-divider-default, #e9ebed)', color: 'var(--color-text-link-default, #0972d3)', margin: '0 auto',
                  }}>
                    {step.icon}
                  </div>
                  <Box variant="h3">{`${i + 1}. ${step.title}`}</Box>
                  <Box color="text-body-secondary" fontSize="body-s">{step.desc}</Box>
                </SpaceBetween>
              </div>
            ))}
          </ColumnLayout>
        </Container>

        {/* Capabilities */}
        <div id="capabilities">
          <Container header={<Header variant="h2" counter={`(${CAPABILITIES.length})`}>Capabilities</Header>}>
            <SpaceBetween size="m">
              {CAPABILITY_CATEGORIES.filter((c) => c !== 'industry_specific').map((catId) => {
                const cat = CATEGORY_INFO[catId];
                const caps = getCapabilitiesByCategory(catId);
                return (
                  <div key={catId}>
                    <SpaceBetween size="xs">
                      <Box variant="h3" padding={{ bottom: 'xxs' }}>{cat.name}</Box>
                      <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 6,
                      }}>
                        {caps.map((cap) => {
                          const supportEntries = cap.support
                            ? Object.entries(cap.support).map(([key, level]) => ({
                                family: key,
                                label: FAMILY_NAMES[key] || key,
                                level: level as SupportLevel,
                              }))
                            : [];

                          return (
                            <Popover
                              key={cap.id}
                              dismissButton={false}
                              position="top"
                              size="large"
                              triggerType="custom"
                              content={
                                <SpaceBetween size="xs">
                                  <Box variant="strong">{cap.name}</Box>
                                  <Box color="text-body-secondary" fontSize="body-s">{cap.description}</Box>
                                  <div style={{ borderTop: '1px solid var(--color-border-divider-default, #e9ebed)', paddingTop: 6, marginTop: 2 }}>
                                    {cap.category === 'document_conversion' ? (
                                      <>
                                        <Box variant="small" fontWeight="bold" padding={{ bottom: 'xxs' }}>Execution Method:</Box>
                                        <div style={{ fontSize: 12, padding: '1px 0' }}>
                                          <StatusIndicator type="info">
                                            Serverless preprocessing (Lambda + Python)
                                          </StatusIndicator>
                                        </div>
                                        <Box variant="small" color="text-body-secondary" padding={{ top: 'xxs' }}>
                                          Not a model-based capability. Runs as a pipeline preprocessing step before BDA/LLM extraction.
                                        </Box>
                                      </>
                                    ) : (
                                      <>
                                        <Box variant="small" fontWeight="bold" padding={{ bottom: 'xxs' }}>Method Support:</Box>
                                        {supportEntries.filter((s) => s.level !== 'none').length > 0 ? (
                                          supportEntries.filter((s) => s.level !== 'none').map((s) => (
                                            <div key={s.family} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '1px 0' }}>
                                              <span>{s.label}</span>
                                              <StatusIndicator
                                                type={s.level === 'excellent' ? 'success' : s.level === 'good' ? 'info' : 'warning'}
                                              >
                                                {s.level}
                                              </StatusIndicator>
                                            </div>
                                          ))
                                        ) : (
                                          <Box variant="small" color="text-body-secondary">No model support — preprocessing step</Box>
                                        )}
                                      </>
                                    )}
                                  </div>
                                  <div style={{ borderTop: '1px solid var(--color-border-divider-default, #e9ebed)', paddingTop: 6, marginTop: 2, fontSize: 12 }}>
                                    <Box variant="small" color="text-body-secondary">
                                      Example: {cap.exampleInput} → {cap.exampleOutput}
                                    </Box>
                                  </div>
                                </SpaceBetween>
                              }
                            >
                              <div
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 6,
                                  padding: '6px 10px', borderRadius: 6,
                                  border: '1px solid var(--color-border-divider-default, #e9ebed)', fontSize: 13,
                                  cursor: 'pointer',
                                  transition: 'border-color 0.15s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-text-link-default, #0972d3)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-divider-default, #e9ebed)'; }}
                              >
                                {getCapabilityIcon(cap.id, 18)}
                                <span>{cap.name}</span>
                              </div>
                            </Popover>
                          );
                        })}
                      </div>
                    </SpaceBetween>
                  </div>
                );
              })}
            </SpaceBetween>
          </Container>
        </div>

        {/* Methods, grouped by role rather than as one flat list of peers */}
        <Container
          header={
            <Header
              variant="h2"
              counter={`(${METHODS.length})`}
              description="Grouped by the role each approach plays. Availability reflects this deployment's configuration."
            >
              Processing Methods
            </Header>
          }
        >
          <SpaceBetween size="l">
            {FAMILY_GROUPS.map((group) => {
              const families = group.families.filter((f) => getMethodsByFamily(f).length > 0);
              if (families.length === 0) return null;
              return (
                <div key={group.title}>
                  <SpaceBetween size="xs">
                    <Box variant="h3">{group.title}</Box>
                    <Box color="text-body-secondary" fontSize="body-s">{group.blurb}</Box>
                    <ColumnLayout columns={3} minColumnWidth={250} variant="text-grid">
                      {families.map((family) => {
                        const methods = getMethodsByFamily(family);
                        return (
                          <SpaceBetween key={family} size="xxs">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Box variant="awsui-key-label">{FAMILY_NAMES[family]}</Box>
                              <Badge>{methods.length}</Badge>
                            </div>
                            {FAMILY_ROLE_NOTES[family] && (
                              <Box color="text-body-secondary" fontSize="body-s">
                                {FAMILY_ROLE_NOTES[family]}
                              </Box>
                            )}
                            {methods.map((m) => (
                              <div
                                key={m.id}
                                style={{
                                  padding: '4px 0',
                                  borderBottom: '1px solid var(--color-border-divider-secondary, #f2f3f3)',
                                  opacity: isUnavailable(m.id) ? 0.65 : 1,
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                  <Box fontSize="body-s" fontWeight="bold">{m.shortName}</Box>
                                  <Box fontSize="body-s" color="text-body-secondary">
                                    {m.family === 'bda-llm'
                                      ? `BDA $0.01/pg + $${m.tokenPricing.inputPer1MTokens}/$${m.tokenPricing.outputPer1MTokens} MTok`
                                      : m.family === 'textract-llm'
                                        ? `Textract $0.0015/pg + $${m.tokenPricing.inputPer1MTokens}/$${m.tokenPricing.outputPer1MTokens} MTok`
                                        : m.tokenPricing.inputPer1MTokens > 0
                                          ? `$${m.tokenPricing.inputPer1MTokens} / $${m.tokenPricing.outputPer1MTokens} MTok`
                                          : `$${m.estimatedCostPerPage.toFixed(2)}/page`}
                                  </Box>
                                </div>
                                {isUnavailable(m.id) && (
                                  <Box fontSize="body-s">
                                    <StatusIndicator type="stopped">
                                      {reasonFor(m.id) ?? 'Not available in this deployment'}
                                    </StatusIndicator>
                                  </Box>
                                )}
                              </div>
                            ))}
                          </SpaceBetween>
                        );
                      })}
                    </ColumnLayout>
                  </SpaceBetween>
                </div>
              );
            })}
          </SpaceBetween>
        </Container>

        <Box color="text-body-secondary" fontSize="body-s" textAlign="center" padding={{ horizontal: 'l' }}>
          * Pricing shown as input / output per 1M tokens for LLM-based methods, and per-page for BDA.
          Actual costs depend on document size, token count, and region. Textract+LLM costs include
          Textract fees ($0.0015/page) plus LLM token costs. See the{' '}
          <a href="https://aws.amazon.com/bedrock/pricing/" target="_blank" rel="noreferrer" style={{ color: 'var(--color-text-link-default, #0972d3)' }}>
            Amazon Bedrock pricing page
          </a>{' '}
          for current rates.
        </Box>

        {/* Upload */}
        <div ref={uploadRef}>
          <Container header={<Header variant="h2" description="Step 1 of 4">Get started</Header>}>
            <DocumentUpload onUploadComplete={handleUploadComplete} />
          </Container>
        </div>

      </SpaceBetween>
    </ContentLayout>
  );
}
