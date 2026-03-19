import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import AppLayout from '@cloudscape-design/components/app-layout';
import Spinner from '@cloudscape-design/components/spinner';
import Box from '@cloudscape-design/components/box';
import type { UploadResponse, Capability, ProcessorResult, ComparisonResult } from '@idp/shared';
import TopNav from './components/layout/TopNav';
import SideNav from './components/layout/SideNav';
import ErrorBoundary from './components/common/ErrorBoundary';
import HomePage from './pages/HomePage';
import { getCurrentUser, type AuthUser } from './services/api';
import type { PreviewResponse } from './hooks/usePreview';

// Lazy-loaded pages for bundle splitting (#20)
const ConversationPage = lazy(() => import('./pages/ConversationPage'));
const PipelinePage = lazy(() => import('./pages/PipelinePage'));
const ProcessingPage = lazy(() => import('./pages/ProcessingPage'));
const ArchitecturePage = lazy(() => import('./pages/ArchitecturePage'));

function PageSpinner() {
  return (
    <Box textAlign="center" padding="xxl">
      <Spinner size="large" />
    </Box>
  );
}

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
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('idp-dark-mode') === 'true');

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  // Dark mode toggle (#16)
  useEffect(() => {
    globalThis.document.body.classList.toggle('awsui-dark-mode', darkMode);
    localStorage.setItem('idp-dark-mode', String(darkMode));
    import('@cloudscape-design/global-styles').then(({ applyMode, Mode }) => {
      applyMode(darkMode ? Mode.Dark : Mode.Light);
    });
  }, [darkMode]);

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
      navigate('/architecture');
    },
    [navigate],
  );

  const handlePipelineComplete = useCallback(
    (results: ProcessorResult[], comp: ComparisonResult) => {
      setProcessingResults(results);
      setComparison(comp);
    },
    [],
  );

  const handleViewArchitecture = useCallback(() => {
    navigate('/architecture');
  }, [navigate]);

  const handleToggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  return (
    <>
      <TopNav user={user} darkMode={darkMode} onToggleDarkMode={handleToggleDarkMode} />
      <AppLayout
        navigation={
          <SideNav activeStep={activeStep} steps={STEPS} />
        }
        content={
          <ErrorBoundary>
            <Suspense fallback={<PageSpinner />}>
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
                      onPipelineComplete={handlePipelineComplete}
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
            </Suspense>
          </ErrorBoundary>
        }
        toolsHide
        navigationWidth={260}
      />
    </>
  );
}
