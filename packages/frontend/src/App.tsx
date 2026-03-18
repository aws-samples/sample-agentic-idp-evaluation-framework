import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import AppLayout from '@cloudscape-design/components/app-layout';
import type { UploadResponse, Capability, ProcessorResult, ComparisonResult } from '@idp/shared';
import TopNav from './components/layout/TopNav';
import SideNav from './components/layout/SideNav';
import HomePage from './pages/HomePage';
import ConversationPage from './pages/ConversationPage';
import PipelinePage from './pages/PipelinePage';
import ProcessingPage from './pages/ProcessingPage';
import ArchitecturePage from './pages/ArchitecturePage';
import { getCurrentUser, type AuthUser } from './services/api';
import type { PreviewResponse } from './hooks/usePreview';

const STEPS = [
  { href: '/', text: 'Upload' },
  { href: '/conversation', text: 'Analyze & Preview' },
  { href: '/pipeline', text: 'Pipeline' },
  { href: '/architecture', text: 'Architecture & Code' },
];

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [document, setDocument] = useState<UploadResponse | null>(null);
  const [selectedCapabilities, setSelectedCapabilities] = useState<Capability[]>([]);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [preferredMethod, setPreferredMethod] = useState<string | undefined>(undefined);
  const [processingResults, setProcessingResults] = useState<ProcessorResult[]>([]);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const currentStepIndex = STEPS.findIndex((s) => s.href === location.pathname);
  const activeStep = currentStepIndex >= 0 ? currentStepIndex : 0;

  const handleUploadComplete = useCallback(
    (doc: UploadResponse) => {
      setDocument(doc);
      navigate('/conversation');
    },
    [navigate],
  );

  const handleCapabilitiesSelected = useCallback(
    (caps: Capability[]) => setSelectedCapabilities(caps),
    [],
  );

  const handleStartProcessing = useCallback((method?: string, preview?: PreviewResponse | null) => {
    if (method) setPreferredMethod(method);
    if (preview) setPreviewData(preview);
    navigate('/pipeline');
  }, [navigate]);

  const handleProcessingComplete = useCallback(
    (results: ProcessorResult[], comp: ComparisonResult) => {
      setProcessingResults(results);
      setComparison(comp);
    },
    [],
  );

  const handleViewArchitecture = useCallback(() => {
    navigate('/architecture');
  }, [navigate]);

  return (
    <>
      <TopNav user={user} />
      <AppLayout
        navigation={
          <SideNav activeStep={activeStep} steps={STEPS} />
        }
        content={
          <Routes>
            <Route
              path="/"
              element={<HomePage onUploadComplete={handleUploadComplete} />}
            />
            <Route
              path="/conversation"
              element={
                <ConversationPage
                  document={document}
                  onCapabilitiesSelected={handleCapabilitiesSelected}
                  onStartProcessing={handleStartProcessing}
                  selectedCapabilities={selectedCapabilities}
                />
              }
            />
            <Route
              path="/pipeline"
              element={
                <PipelinePage
                  document={document}
                  capabilities={selectedCapabilities}
                  previewData={previewData}
                  preferredMethod={preferredMethod}
                  onViewArchitecture={handleViewArchitecture}
                />
              }
            />
            <Route
              path="/processing"
              element={
                <ProcessingPage
                  document={document}
                  capabilities={selectedCapabilities}
                  onComplete={handleProcessingComplete}
                  onViewArchitecture={handleViewArchitecture}
                />
              }
            />
            <Route
              path="/architecture"
              element={
                <ArchitecturePage
                  document={document}
                  processingResults={processingResults}
                  comparison={comparison}
                  capabilities={selectedCapabilities}
                />
              }
            />
          </Routes>
        }
        toolsHide
        navigationWidth={260}
      />
    </>
  );
}
