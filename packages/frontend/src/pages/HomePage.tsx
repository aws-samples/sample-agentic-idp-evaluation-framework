import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Table from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import Toggle from '@cloudscape-design/components/toggle';
import type { UploadResponse } from '@idp/shared';
import {
  CAPABILITIES,
  CATEGORY_INFO,
  CAPABILITY_CATEGORIES,
  getCapabilitiesByCategory,
  METHODS,
  METHOD_INFO,
  METHOD_FAMILIES,
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
import { FAMILY_COLORS, FAMILY_FULL_NAMES } from '../theme/family-colors';
import { token } from '../theme/tokens';

interface HomePageProps {
  onUploadComplete: (doc: UploadResponse) => void;
}

/**
 * What a method costs, in the unit that method is actually billed in.
 *
 * Three different billing shapes, and showing the wrong one is worse than showing
 * nothing: token models are per-MTok, the two-stage hybrids add a per-page service fee
 * on top of tokens, and the page-priced methods (Guardrails, embeddings, self-hosted
 * OCR) have no token price at all.
 */
function priceLabel(m: { family: string; tokenPricing: { inputPer1MTokens: number; outputPer1MTokens: number }; estimatedCostPerPage: number }): string {
  const tokens = `$${m.tokenPricing.inputPer1MTokens} / $${m.tokenPricing.outputPer1MTokens} per MTok`;
  if (m.family === 'bda-llm') return `$0.01/page + ${tokens}`;
  if (m.family === 'textract-llm') return `$0.0015/page + ${tokens}`;
  if (m.tokenPricing.inputPer1MTokens > 0) return tokens;
  /*
   * 4 decimals, not 2: Guardrails is $0.0016/page and Nova Embeddings $0.0005/page,
   * both of which toFixed(2) rendered as "$0.00/page" — advertising a billed method
   * as free.
   */
  return `$${m.estimatedCostPerPage.toFixed(4)}/page`;
}

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

/**
 * Which role group a family belongs to, inverted from FAMILY_GROUPS.
 *
 * The table needs the lookup per row, and deriving it here means the editorial grouping
 * above stays the single place it is declared.
 */
const ROLE_OF_FAMILY = new Map<MethodFamily, string>(
  ALL_FAMILY_GROUPS.flatMap((g) => g.families.map((f) => [f, g.title] as const)),
);

/** Short role label for a table cell — the group titles are written as headings. */
const ROLE_SHORT: Record<string, string> = {
  'General-purpose models': 'General-purpose',
  'Managed extraction pipelines': 'Managed pipeline',
  'Two-stage hybrids': 'Two-stage hybrid',
  'Purpose-built media models': 'Media',
  'Specialist OCR (self-hosted)': 'Specialist OCR',
  'Specialized services': 'Specialized',
  'Other methods': 'Other',
};

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

  // ─── Processing-methods table ─────────────────────────────────────────────
  const [methodFilter, setMethodFilter] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [methodSort, setMethodSort] = useState<{
    sortingColumn: { sortingField?: string };
    isDescending: boolean;
  }>({ sortingColumn: { sortingField: 'role' }, isDescending: false });

  /**
   * One row per method, flattened from the catalog.
   *
   * Built from METHODS directly rather than by walking the role groups, so a method
   * cannot be dropped by a grouping gap — that is exactly how seven methods once
   * vanished from this page while the header still counted 29.
   */
  const METHOD_ROWS = useMemo(
    () => METHODS.map((id) => {
      const info = METHOD_INFO[id];
      const role = ROLE_OF_FAMILY.get(info.family) ?? 'Other methods';
      return {
        id,
        name: info.shortName,
        family: info.family,
        familyName: FAMILY_FULL_NAMES[info.family],
        role: ROLE_SHORT[role] ?? role,
        price: priceLabel(info),
        // Sort key for price: the per-page figure is the only number comparable
        // across token-priced, page-priced and two-stage methods.
        costPerPage: info.estimatedCostPerPage,
        note: FAMILY_ROLE_NOTES[info.family],
        unavailable: isUnavailable(id),
        reason: reasonFor(id),
      };
    }),
    [isUnavailable, reasonFor],
  );

  const visibleMethodRows = useMemo(() => {
    const q = methodFilter.trim().toLowerCase();
    const rows = METHOD_ROWS.filter((r) => {
      if (availableOnly && r.unavailable) return false;
      if (!q) return true;
      // Match the id too: someone reading an API response or an error searches for that.
      return `${r.name} ${r.familyName} ${r.role} ${r.id}`.toLowerCase().includes(q);
    });
    const field = methodSort.sortingColumn.sortingField ?? 'role';
    const dir = methodSort.isDescending ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (field === 'costPerPage') return (a.costPerPage - b.costPerPage) * dir;
      const av = String(a[field as 'name' | 'familyName' | 'role']);
      const bv = String(b[field as 'name' | 'familyName' | 'role']);
      // Within a role or family, keep a stable secondary order by name rather than
      // whatever the catalog happens to list first.
      return (av.localeCompare(bv) || a.name.localeCompare(b.name)) * dir;
    });
  }, [METHOD_ROWS, methodFilter, availableOnly, methodSort]);

  type MethodRow = (typeof METHOD_ROWS)[number];

  const METHOD_COLUMNS = useMemo(() => [
    {
      id: 'name',
      header: 'Method',
      sortingField: 'name',
      cell: (r: MethodRow) => (
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          {/* The family colour, as a 3px rule — the same hue used on the pipeline canvas. */}
          <div style={{
            width: 3, height: 15, borderRadius: 2,
            background: FAMILY_COLORS[r.family], flexShrink: 0,
          }} />
          <Box fontWeight="bold" color={r.unavailable ? 'text-status-inactive' : undefined}>
            {r.name}
          </Box>
        </SpaceBetween>
      ),
      minWidth: 170,
    },
    {
      id: 'role',
      header: 'Role',
      sortingField: 'role',
      cell: (r: MethodRow) => <Box color="text-body-secondary">{r.role}</Box>,
      minWidth: 150,
    },
    {
      id: 'family',
      header: 'Family',
      sortingField: 'familyName',
      /*
       * The family note lives here, on hover, rather than as a paragraph above a group.
       * Some families genuinely need explaining — Guardrails only applies to PII, Pegasus
       * cannot read a document at all, self-hosted OCR bills by GPU hour — and printing
       * those as per-group prose is what made the old panel three layers deep. Only
       * families that HAVE a note become a trigger, so there is no dead affordance.
       */
      cell: (r: MethodRow) => (r.note
        ? (
          <Popover
            dismissButton={false}
            position="top"
            size="medium"
            triggerType="text"
            content={r.note}
          >
            <Box color="text-body-secondary">{r.familyName}</Box>
          </Popover>
        )
        : <Box color="text-body-secondary">{r.familyName}</Box>),
      minWidth: 180,
    },
    {
      id: 'price',
      header: 'Pricing',
      sortingField: 'costPerPage',
      cell: (r: MethodRow) => <Box color="text-body-secondary">{r.price}</Box>,
      minWidth: 230,
    },
    {
      id: 'status',
      header: 'In this deployment',
      cell: (r: MethodRow) => (r.unavailable
        ? (
          /*
           * The reason, per row, but truncated with the full text on hover. Stating it
           * in full inline is what made six identical three-line sentences dominate the
           * old panel; omitting it entirely leaves the user guessing why a method they
           * can see cannot be used.
           */
          <Popover
            dismissButton={false}
            position="left"
            size="medium"
            triggerType="text"
            content={r.reason ?? 'Not available in this deployment.'}
          >
            <StatusIndicator type="stopped">Not available</StatusIndicator>
          </Popover>
        )
        : <StatusIndicator type="success">Ready</StatusIndicator>),
      minWidth: 150,
    },
  ], []);

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
                            label: FAMILY_FULL_NAMES[family],
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
        {/*
          Folded by default, like the support matrix below it.
          These two are REFERENCE tables — 29 methods and a 33x29 grid. Expanded, they
          pushed the one thing a first-time visitor needs to do (upload a document) far
          above the fold and made the landing page read as a spec sheet. Capabilities stays
          open because it answers "what can this thing even do?", which is the question a
          newcomer actually has.
        */}
        <ExpandableSection
          variant="container"
          headerText="Processing methods"
          headerCounter={`(${METHODS.length})`}
          headerDescription="Every method this framework can run, what role it plays, and what it costs. Sort or filter to compare; hover a family for what it is good at."
          headerActions={
            <Button
              variant="icon"
              iconName="close"
              ariaLabel="Hide the capability and method reference"
              onClick={() => hideCatalogs(true)}
            />
          }
        >
          {/*
            ONE flat table, not a tree of boxes.
            The previous version nested four levels deep — an ExpandableSection with
            `variant="container"` (a box), holding a div per role group (a box), holding a
            ColumnLayout of per-family blocks (a box), each holding its own bordered rows.
            Every level added a heading, a blurb and its own padding, so a reader hunting
            one method waded through three layers of prose per group, and the same
            information appeared at two different nesting levels depending on whether a
            group happened to hold one family or two.
            A table answers the actual question — what can I run, on what, for how much —
            in one scan. `Role` and `Family` become columns rather than containers, so they
            are still visible and now sortable; grouping that used to cost a box costs a
            cell. Filtering replaces the per-group "count vs list" mismatch entirely: the
            counter reads the filtered rows, so it cannot disagree with what is rendered.
          */}
          <Table
            variant="embedded"
            items={visibleMethodRows}
            trackBy="id"
            sortingColumn={methodSort.sortingColumn}
            sortingDescending={methodSort.isDescending}
            onSortingChange={({ detail }) => setMethodSort({
              sortingColumn: detail.sortingColumn,
              isDescending: detail.isDescending ?? false,
            })}
            columnDefinitions={METHOD_COLUMNS}
            stripedRows
            wrapLines
            filter={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                <TextFilter
                  filteringText={methodFilter}
                  filteringPlaceholder="Find a method"
                  filteringAriaLabel="Find a processing method"
                  countText={`${visibleMethodRows.length} of ${METHOD_ROWS.length} matches`}
                  onChange={({ detail }) => setMethodFilter(detail.filteringText)}
                />
                {/*
                  8 of 29 methods are unavailable on a default deployment (BDA Custom, Nova
                  Embeddings, six SageMaker OCR models). They stay listed — the catalog is a
                  reference, and hiding them made "29 methods" disagree with the list — but
                  someone deciding what to run wants the runnable set, so make that one click.
                */}
                <Toggle
                  checked={availableOnly}
                  onChange={({ detail }) => setAvailableOnly(detail.checked)}
                >
                  Available here only
                </Toggle>
              </SpaceBetween>
            }
            empty={
              <Box textAlign="center" color="text-body-secondary" padding={{ vertical: 'l' }}>
                <SpaceBetween size="xs">
                  <span>No method matches “{methodFilter}”.</span>
                  <Button variant="inline-link" onClick={() => { setMethodFilter(''); setAvailableOnly(false); }}>
                    Clear filters
                  </Button>
                </SpaceBetween>
              </Box>
            }
          />
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
