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
  CAPABILITY_SUPPORT,
  getCapabilitiesByCategory,
  METHOD_FAMILIES,
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
  FileText,
  PenLine,
  Table2,
  List,
  Users,
  Image,
  ScanSearch,
  PenTool,
  Barcode,
  LayoutGrid,
  FolderOpen,
  Scissors,
  AlignLeft,
  Globe,
  Shield,
  EyeOff,
  FileOutput,
  Ruler,
  ScanEye,
} from 'lucide-react';
import DocumentUpload from '../components/upload/DocumentUpload';
import OnboardingBanner from '../components/common/OnboardingBanner';

interface HomePageProps {
  onUploadComplete: (doc: UploadResponse) => void;
}

const ICON_COLOR = '#545b64';

const CAPABILITY_ICONS: Record<string, React.ReactNode> = {
  text_extraction: <FileText size={18} color={ICON_COLOR} />,
  handwriting_extraction: <PenLine size={18} color={ICON_COLOR} />,
  table_extraction: <Table2 size={18} color={ICON_COLOR} />,
  kv_extraction: <List size={18} color={ICON_COLOR} />,
  entity_extraction: <Users size={18} color={ICON_COLOR} />,
  image_description: <Image size={18} color={ICON_COLOR} />,
  bounding_box: <ScanSearch size={18} color={ICON_COLOR} />,
  signature_detection: <PenTool size={18} color={ICON_COLOR} />,
  barcode_qr: <Barcode size={18} color={ICON_COLOR} />,
  layout_analysis: <LayoutGrid size={18} color={ICON_COLOR} />,
  document_classification: <FolderOpen size={18} color={ICON_COLOR} />,
  document_splitting: <Scissors size={18} color={ICON_COLOR} />,
  document_summarization: <AlignLeft size={18} color={ICON_COLOR} />,
  language_detection: <Globe size={18} color={ICON_COLOR} />,
  pii_detection: <Shield size={18} color={ICON_COLOR} />,
  pii_redaction: <EyeOff size={18} color={ICON_COLOR} />,
  video_summarization: <FileText size={18} color={ICON_COLOR} />,
  video_chapter_extraction: <Scissors size={18} color={ICON_COLOR} />,
  audio_transcription: <FileText size={18} color={ICON_COLOR} />,
  audio_summarization: <AlignLeft size={18} color={ICON_COLOR} />,
  content_moderation: <Shield size={18} color={ICON_COLOR} />,
  image_separation: <Scissors size={18} color={ICON_COLOR} />,
  embedding_generation: <GitCompareArrows size={18} color={ICON_COLOR} />,
  knowledge_base_ingestion: <FolderOpen size={18} color={ICON_COLOR} />,
  pdf_conversion: <FileOutput size={18} color={ICON_COLOR} />,
  format_standardization: <Ruler size={18} color={ICON_COLOR} />,
  ocr_enhancement: <ScanEye size={18} color={ICON_COLOR} />,
};

const FAMILY_NAMES: Record<string, string> = {
  bda: 'Bedrock Data Automation',
  'bda-llm': 'BDA + LLM Hybrid',
  claude: 'Claude Models',
  nova: 'Nova Models',
  'textract-llm': 'Textract + LLM',
  embeddings: 'Embeddings',
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

  const handleUploadComplete = (doc: UploadResponse) => {
    onUploadComplete(doc);
    navigate('/conversation');
  };

  const scrollToUpload = () => {
    uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <ContentLayout
      header={
        <Header variant="h1" description="Evaluate, compare, and recommend the optimal AWS document processing approach.">
          IDP Evaluation Framework
        </Header>
      }
    >
      <SpaceBetween size="l">

        {/* Hero */}
        <Container>
          <div style={{ textAlign: 'center', padding: '24px 0 16px' }}>
            <SpaceBetween size="s">
              <Box variant="h2" fontSize="display-l">Find the Right IDP Approach</Box>
              <Box color="text-body-secondary" fontSize="heading-s" padding={{ horizontal: 'xxxl' }}>
                Upload a document and let our AI advisor analyze it, recommend the right capabilities,
                then compare processing methods side-by-side for accuracy, cost, and speed.
              </Box>
              <div style={{ paddingTop: 12 }}>
                <Button variant="primary" iconName="upload" onClick={scrollToUpload}>
                  Start Evaluation
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
                    border: '1px solid #e9ebed', color: '#0972d3', margin: '0 auto',
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
                          const families: MethodFamily[] = ['claude', 'bda', 'bda-llm', 'textract-llm', 'nova', 'embeddings'];
                          const familyLabels: Record<string, string> = {
                            claude: 'Claude (LLM)',
                            bda: 'BDA',
                            'bda-llm': 'BDA+LLM',
                            'textract-llm': 'Textract+LLM',
                            nova: 'Nova (LLM)',
                            embeddings: 'Nova Embeddings',
                          };
                          const supportEntries = families
                            .map((f) => ({
                              family: f,
                              label: familyLabels[f],
                              level: (CAPABILITY_SUPPORT[f]?.[cap.id as keyof typeof CAPABILITY_SUPPORT[typeof f]] ?? 'none') as SupportLevel,
                            }))
                            .filter((s) => s.level !== 'none' || families.slice(0, 4).includes(s.family as MethodFamily));

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
                                  <div style={{ borderTop: '1px solid #e9ebed', paddingTop: 6, marginTop: 2 }}>
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
                                  <div style={{ borderTop: '1px solid #e9ebed', paddingTop: 6, marginTop: 2, fontSize: 12 }}>
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
                                  border: '1px solid #e9ebed', fontSize: 13,
                                  cursor: 'pointer',
                                  transition: 'border-color 0.15s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0972d3'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e9ebed'; }}
                              >
                                {CAPABILITY_ICONS[cap.id]}
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

        {/* Methods */}
        <Container header={<Header variant="h2" counter={`(${METHODS.length})`}>Processing Methods</Header>}>
          <ColumnLayout columns={3} minColumnWidth={250} variant="text-grid">
            {METHOD_FAMILIES.map((family) => {
              const methods = getMethodsByFamily(family);
              return (
                <SpaceBetween key={family} size="xs">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Box variant="h3">{FAMILY_NAMES[family]}</Box>
                    <Badge>{methods.length}</Badge>
                  </div>
                  {methods.map((m) => (
                    <div key={m.id} style={{ padding: '4px 0', borderBottom: '1px solid #f2f3f3' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <Box fontSize="body-s" fontWeight="bold">{m.shortName}</Box>
                        {m.family !== 'textract-llm' && m.family !== 'bda-llm' && (
                          m.tokenPricing.inputPer1MTokens > 0 ? (
                            <Box fontSize="body-s" color="text-body-secondary">
                              ${m.tokenPricing.inputPer1MTokens} / ${m.tokenPricing.outputPer1MTokens} MTok
                            </Box>
                          ) : (
                            <Box fontSize="body-s" color="text-body-secondary">
                              ${m.estimatedCostPerPage.toFixed(2)}/page
                            </Box>
                          )
                        )}
                      </div>
                      {m.family === 'bda-llm' && (
                        <Box fontSize="body-s" color="text-body-secondary">
                          BDA $0.01/pg + LLM ${m.tokenPricing.inputPer1MTokens}/${m.tokenPricing.outputPer1MTokens} MTok
                        </Box>
                      )}
                      {m.family === 'textract-llm' && (
                        <Box fontSize="body-s" color="text-body-secondary">
                          Textract $0.0015/pg + LLM ${m.tokenPricing.inputPer1MTokens}/${m.tokenPricing.outputPer1MTokens} MTok
                        </Box>
                      )}
                    </div>
                  ))}
                </SpaceBetween>
              );
            })}
          </ColumnLayout>
        </Container>

        <Box color="text-body-secondary" fontSize="body-s" textAlign="center" padding={{ horizontal: 'l' }}>
          * Pricing shown as input / output per 1M tokens for LLM-based methods, and per-page for BDA.
          Actual costs depend on document size, token count, and region. Textract+LLM costs include
          Textract fees ($0.0015/page) plus LLM token costs. See the{' '}
          <a href="https://aws.amazon.com/bedrock/pricing/" target="_blank" rel="noreferrer" style={{ color: '#0972d3' }}>
            Amazon Bedrock pricing page
          </a>{' '}
          for current rates.
        </Box>

        {/* Upload */}
        <div ref={uploadRef}>
          <Container header={<Header variant="h2">Get Started</Header>}>
            <DocumentUpload onUploadComplete={handleUploadComplete} />
          </Container>
        </div>

      </SpaceBetween>
    </ContentLayout>
  );
}
