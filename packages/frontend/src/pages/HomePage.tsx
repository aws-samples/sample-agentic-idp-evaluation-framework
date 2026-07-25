import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Badge from '@cloudscape-design/components/badge';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import type { UploadResponse } from '@idp/shared';
import {
  CAPABILITIES,
  CATEGORY_INFO,
  CAPABILITY_CATEGORIES,
  getCapabilitiesByCategory,
  METHODS,
  METHOD_FAMILIES,
  getMethodsByFamily,
  PRODUCT_NAME,
  PRODUCT_TAGLINE
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
import Button from '@cloudscape-design/components/button';
import DocumentUpload from '../components/upload/DocumentUpload';
import SupportMatrix from '../components/common/SupportMatrix';
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
  embeddings: 'Nova Embeddings',
  guardrails: 'Bedrock Guardrails',
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
    title: 'Purpose-built media models',
    blurb: 'Built for video rather than pages — they read visuals, audio and on-screen text with timestamps.',
    families: ['video-understanding'],
  },
  {
    title: 'Specialist OCR (self-hosted)',
    blurb: 'Document-OCR models on your own SageMaker endpoints. Strongest at dense layouts and grids; billed by GPU hour, so each is opt-in.',
    families: ['sagemaker-ocr'],
  },
  {
    title: 'Specialized services',
    blurb: 'Purpose-built for one job rather than general extraction.',
    families: ['guardrails', 'embeddings'],
  },
];

/*
 * Every family MUST appear in exactly one group above.
 *
 * FAMILY_GROUPS is hand-ordered (the order is editorial — general-purpose first,
 * niche last), so it cannot be derived from METHOD_FAMILIES. But that made it a
 * second list to keep in sync, and it went stale immediately: adding
 * `video-understanding` and `sagemaker-ocr` left them in no group, so the header
 * counted 29 methods while the body rendered only 22 — seven methods vanished from
 * the first screen a user sees, with no error anywhere.
 *
 * Rendering the leftovers instead of dropping them means a future family shows up
 * ungrouped-but-visible rather than silently disappearing.
 */
const GROUPED_FAMILIES = new Set(FAMILY_GROUPS.flatMap((g) => g.families));
const UNGROUPED_FAMILIES = METHOD_FAMILIES.filter((f) => !GROUPED_FAMILIES.has(f));

const ALL_FAMILY_GROUPS: typeof FAMILY_GROUPS = UNGROUPED_FAMILIES.length > 0
  ? [
    ...FAMILY_GROUPS,
    {
      title: 'Other methods',
      blurb: 'Not yet assigned to a role group above.',
      families: UNGROUPED_FAMILIES,
    },
  ]
  : FAMILY_GROUPS;

/** Per-family note explaining what the family actually is, where it is not obvious. */
const FAMILY_ROLE_NOTES: Partial<Record<MethodFamily, string>> = {
  guardrails: 'Deterministic PII detection and redaction policy — applies only to PII capabilities, not general extraction.',
  embeddings: 'Produces vectors for search and retrieval, not extracted fields.',
  bda: 'Fully managed extraction service. Requires a data-automation profile.',
  'video-understanding': 'Reads video natively — visuals, audio and on-screen text — and answers with timestamps. Video input only; it cannot read a document.',
  'sagemaker-ocr': 'Specialist document-OCR models you host yourself. Cost is GPU hours rather than tokens, so each endpoint is opt-in and off unless configured.',
};

const STEPS = [
  { icon: <Upload size={24} strokeWidth={1.5} />, title: 'Upload', desc: 'Upload any document — PDF, image, Word, Excel, or PowerPoint.' },
  { icon: <MessageSquare size={24} strokeWidth={1.5} />, title: 'Analyze', desc: 'AI advisor identifies structure and recommends capabilities.' },
  { icon: <GitCompareArrows size={24} strokeWidth={1.5} />, title: 'Compare', desc: 'Run methods in parallel. See cost, speed, and confidence.' },
  { icon: <Award size={24} strokeWidth={1.5} />, title: 'Recommend', desc: 'Get architecture guidance with cost projections at scale.' },
];

/** localStorage key for the dismissed-catalogs preference. */
const CATALOG_HIDDEN_KEY = 'idp-catalogs-hidden';

export default function HomePage({ onUploadComplete }: HomePageProps) {
  const uploadRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isUnavailable, reasonFor } = useMethodAvailability();

  /*
   * Reference catalogs are OPEN by default and dismissible with an ✕.
   *
   * They were collapsed by default so the upload control could be the hero, but
   * collapsed-by-default hides the thing that explains what the tool can do — a
   * first-time visitor saw two closed accordions. Open-by-default with an explicit
   * dismiss is the better trade: the information is there when you arrive, and once
   * you know the catalog you can hide it for good. Upload stays above them either
   * way, so the hero is unaffected.
   *
   * The preference is deliberately NOT part of the workflow state cleared by
   * "Start over" (see WORKFLOW_KEYS in App.tsx) — it is a preference, not evaluation
   * state.
   */
  const [catalogsHidden, setCatalogsHidden] = useState(
    () => localStorage.getItem(CATALOG_HIDDEN_KEY) === 'true',
  );
  const hideCatalogs = useCallback((hidden: boolean) => {
    setCatalogsHidden(hidden);
    try {
      localStorage.setItem(CATALOG_HIDDEN_KEY, String(hidden));
    } catch { /* preference only — a quota failure must not break the page */ }
  }, []);

  const handleUploadComplete = (doc: UploadResponse) => {
    onUploadComplete(doc);
    navigate('/conversation');
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={PRODUCT_TAGLINE}
        >
          {PRODUCT_NAME}
        </Header>
      }
    >
      <SpaceBetween size="l">

        {/*
          Upload IS the hero.
          The landing page used to open with a hero that only scrolled, then two
          long reference catalogs (33 capabilities, 22 methods), and finally the
          file input at the very bottom — the one thing the user came to do was
          below three screens of documentation. Action first, reference after.
        */}
        <div ref={uploadRef}>
          <Container
            header={
              <Header
                variant="h2"
                description="Step 1 of 4 · PDF, image, Word, Excel, PowerPoint, audio or video · max 50 MB"
              >
                Upload a document to start
              </Header>
            }
          >
            <SpaceBetween size="l">
              <DocumentUpload onUploadComplete={handleUploadComplete} bare />

              {/* What happens next — inline, so the flow is clear before committing. */}
              <ColumnLayout columns={4} minColumnWidth={180} variant="text-grid">
                {STEPS.map((step, i) => (
                  <div key={step.title}>
                    <SpaceBetween size="xxs">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Box color="text-status-info">{step.icon}</Box>
                        <Box variant="awsui-key-label">{`${i + 1}. ${step.title}`}</Box>
                      </div>
                      <Box color="text-body-secondary" fontSize="body-s">{step.desc}</Box>
                    </SpaceBetween>
                  </div>
                ))}
              </ColumnLayout>
            </SpaceBetween>
          </Container>
        </div>

        {/* Capabilities */}
        {/*
          Reference catalogs, collapsed by default. They are useful context but
          they are not the task, and expanded they pushed the upload control
          three screens down.
        */}
        {catalogsHidden && (
          <Box textAlign="center">
            <Button variant="inline-link" iconName="add-plus" onClick={() => hideCatalogs(false)}>
              Show the capability and method reference
            </Button>
          </Box>
        )}

        <div id="capabilities" hidden={catalogsHidden}>
          <ExpandableSection
            variant="container"
            defaultExpanded
            headerText="Capabilities"
            headerCounter={`(${CAPABILITIES.length})`}
            headerDescription="What you can ask a method to extract. The advisor recommends a set for your document."
            headerActions={
              <Button
                variant="icon"
                iconName="close"
                ariaLabel="Hide the capability and method reference"
                onClick={() => hideCatalogs(true)}
              />
            }
          >
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
                          /*
                           * Every family, including the ones that cannot do this.
                           *
                           * The popover used to build rows from `cap.support` and then
                           * filter out `none`, so an unsupported family simply did not
                           * appear — indistinguishable from a family the catalog forgot
                           * to rate. For a table someone reads to choose a method,
                           * absence is ambiguous; state it.
                           */
                          const supportEntries = METHOD_FAMILIES.map((family) => ({
                            family,
                            label: FAMILY_NAMES[family] || family,
                            level: (cap.support?.[family] ?? 'none') as SupportLevel,
                          }));

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
                                        {supportEntries.some((s) => s.level !== 'none') ? (
                                          supportEntries.map((s) => (
                                            <div key={s.family} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '1px 0' }}>
                                              <span style={{ opacity: s.level === 'none' ? 0.6 : 1 }}>{s.label}</span>
                                              <StatusIndicator
                                                type={
                                                  s.level === 'excellent' ? 'success'
                                                    : s.level === 'good' ? 'info'
                                                      : s.level === 'limited' ? 'warning'
                                                        : 'stopped'
                                                }
                                              >
                                                {s.level === 'none' ? 'not supported' : s.level}
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
          </ExpandableSection>
        </div>

        {/* Methods, grouped by role rather than as one flat list of peers */}
        <div hidden={catalogsHidden}>
        <ExpandableSection
          variant="container"
          defaultExpanded
          headerText="Processing methods"
          headerCounter={`(${METHODS.length})`}
          headerDescription="Grouped by the role each approach plays. Availability reflects this deployment's configuration."
          headerActions={
            <Button
              variant="icon"
              iconName="close"
              ariaLabel="Hide the capability and method reference"
              onClick={() => hideCatalogs(true)}
            />
          }
        >
          <SpaceBetween size="l">
            {ALL_FAMILY_GROUPS.map((group) => {
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
                                          // 4 decimals, not 2: Guardrails is $0.0016/page and
                                          // Nova Embeddings $0.0005/page, both of which
                                          // toFixed(2) rendered as "$0.00/page" — advertising a
                                          // billed method as free.
                                          : `$${m.estimatedCostPerPage.toFixed(4)}/page`}
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
        </ExpandableSection>
        </div>

        {/*
          The full capability x method matrix. The catalogs above answer "what
          capabilities exist" and "what methods exist" separately; only this answers
          the question that actually decides a pipeline — can THIS method do THIS
          thing, and how well.
        */}
        <div hidden={catalogsHidden}>
          <ExpandableSection
            variant="container"
            headerText="Support matrix"
            headerCounter={`(${CAPABILITIES.length} x ${METHODS.length})`}
            headerDescription="Every capability against every method, with the support level for each pair."
            headerActions={
              <Button
                variant="icon"
                iconName="close"
                ariaLabel="Hide the capability and method reference"
                onClick={() => hideCatalogs(true)}
              />
            }
          >
            <SupportMatrix />
          </ExpandableSection>
        </div>

        <Box color="text-body-secondary" fontSize="body-s" textAlign="center" padding={{ horizontal: 'l' }}>
          * Pricing shown as input / output per 1M tokens for LLM-based methods, and per-page for BDA.
          Actual costs depend on document size, token count, and region. Textract+LLM costs include
          Textract fees ($0.0015/page) plus LLM token costs. See the{' '}
          <a href="https://aws.amazon.com/bedrock/pricing/" target="_blank" rel="noreferrer" style={{ color: 'var(--color-text-link-default, #0972d3)' }}>
            Amazon Bedrock pricing page
          </a>{' '}
          for current rates.
        </Box>


      </SpaceBetween>
    </ContentLayout>
  );
}
