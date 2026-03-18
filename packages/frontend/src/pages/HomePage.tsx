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
  CATEGORY_INFO,
  CAPABILITY_CATEGORIES,
  CAPABILITY_SUPPORT,
  getCapabilitiesByCategory,
  METHOD_FAMILIES,
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
  Receipt,
  ShoppingCart,
  CreditCard,
  ShieldCheck,
  HeartPulse,
  Scale,
} from 'lucide-react';
import DocumentUpload from '../components/upload/DocumentUpload';

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
  invoice_processing: <Receipt size={18} color={ICON_COLOR} />,
  receipt_parsing: <ShoppingCart size={18} color={ICON_COLOR} />,
  check_processing: <CreditCard size={18} color={ICON_COLOR} />,
  insurance_claims: <ShieldCheck size={18} color={ICON_COLOR} />,
  medical_records: <HeartPulse size={18} color={ICON_COLOR} />,
  contract_analysis: <Scale size={18} color={ICON_COLOR} />,
  video_summarization: <FileText size={18} color={ICON_COLOR} />,
  video_chapter_extraction: <Scissors size={18} color={ICON_COLOR} />,
  audio_transcription: <FileText size={18} color={ICON_COLOR} />,
  audio_summarization: <AlignLeft size={18} color={ICON_COLOR} />,
  content_moderation: <Shield size={18} color={ICON_COLOR} />,
};

const FAMILY_NAMES: Record<string, string> = {
  bda: 'Bedrock Data Automation',
  claude: 'Claude Models',
  nova: 'Nova Models',
  'textract-llm': 'Textract + LLM',
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
          IDP Evaluation Platform
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
                Upload a sample document. Our AI advisor runs 11 processing methods in parallel
                and tells you which gives the best accuracy, cost, and speed for your use case.
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
          <ColumnLayout columns={4} variant="text-grid">
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
          <Container header={<Header variant="h2" counter="(22)">Capabilities</Header>}>
            <SpaceBetween size="m">
              {CAPABILITY_CATEGORIES.map((catId) => {
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
                          const families: MethodFamily[] = ['claude', 'bda', 'textract-llm', 'nova'];
                          const familyLabels: Record<string, string> = {
                            claude: 'Claude (LLM)',
                            bda: 'BDA',
                            'textract-llm': 'Textract+LLM',
                            nova: 'Nova (LLM)',
                          };
                          const supportEntries = families.map((f) => ({
                            family: f,
                            label: familyLabels[f],
                            level: (CAPABILITY_SUPPORT[f]?.[cap.id as keyof typeof CAPABILITY_SUPPORT[typeof f]] ?? 'none') as SupportLevel,
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
                                  <div style={{ borderTop: '1px solid #e9ebed', paddingTop: 6, marginTop: 2 }}>
                                    <Box variant="small" fontWeight="bold" padding={{ bottom: 'xxs' }}>Method Support:</Box>
                                    {supportEntries.map((s) => (
                                      <div key={s.family} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '1px 0' }}>
                                        <span>{s.label}</span>
                                        <StatusIndicator
                                          type={s.level === 'excellent' ? 'success' : s.level === 'good' ? 'info' : s.level === 'limited' ? 'warning' : 'error'}
                                        >
                                          {s.level}
                                        </StatusIndicator>
                                      </div>
                                    ))}
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
        <Container header={<Header variant="h2" counter="(11)">Processing Methods</Header>}>
          <ColumnLayout columns={4} variant="text-grid">
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
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Box fontSize="body-s" fontWeight="bold">{m.shortName}</Box>
                        {m.family === 'textract-llm' ? (
                          <Box fontSize="body-s" color="text-body-secondary">
                            $0.0015/pg + ${m.tokenPricing.inputPer1MTokens}/${m.tokenPricing.outputPer1MTokens} MTok
                          </Box>
                        ) : m.tokenPricing.inputPer1MTokens > 0 ? (
                          <Box fontSize="body-s" color="text-body-secondary">
                            ${m.tokenPricing.inputPer1MTokens} / ${m.tokenPricing.outputPer1MTokens} MTok
                          </Box>
                        ) : (
                          <Box fontSize="body-s" color="text-body-secondary">
                            ${m.estimatedCostPerPage.toFixed(2)}/page
                          </Box>
                        )}
                      </div>
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
