import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import AppLayout from '@cloudscape-design/components/app-layout';
import Spinner from '@cloudscape-design/components/spinner';
import Box from '@cloudscape-design/components/box';
import type { UploadResponse, Capability, ProcessorResult, ComparisonResult, PipelineDefinition } from '@idp/shared';
import TopNav from './components/layout/TopNav';
import SideNav from './components/layout/SideNav';
import ErrorBoundary from './components/common/ErrorBoundary';
import HomePage from './pages/HomePage';
import type { AuthUser } from './services/api';
import { authedFetch } from './services/api';
import type { PreviewResponse } from './hooks/usePreview';
import FeedbackModal from './components/feedback/FeedbackModal';

// Lazy-loaded pages for bundle splitting (#20)
const ConversationPage = lazy(() => import('./pages/ConversationPage'));
const PipelinePage = lazy(() => import('./pages/PipelinePage'));
const ProcessingPage = lazy(() => import('./pages/ProcessingPage'));
const ArchitecturePage = lazy(() => import('./pages/ArchitecturePage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const SurveyResultsPage = lazy(() => import('./pages/SurveyResultsPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));

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

const ADMIN_USERS = (import.meta.env.VITE_ADMIN_USERS || '').split(',').filter(Boolean);

// Persist state in sessionStorage so it survives navigation and page refreshes
function loadSession<T>(key: string, fallback: T): T {
  try {
    const saved = sessionStorage.getItem(`idp-${key}`);
    return saved ? JSON.parse(saved) : fallback;
  } catch { return fallback; }
}
function saveSession(key: string, value: unknown) {
  try { sessionStorage.setItem(`idp-${key}`, JSON.stringify(value)); } catch { /* quota */ }
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [document, setDocument] = useState<UploadResponse | null>(() => loadSession('document', null));
  const [selectedCapabilities, setSelectedCapabilities] = useState<Capability[]>(() => loadSession('capabilities', []));
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(() => loadSession('previewData', null));
  const [preferredMethod, setPreferredMethod] = useState<string | undefined>(() => loadSession('preferredMethod', undefined));
  const [documentLanguages, setDocumentLanguages] = useState<string[]>(() => loadSession('documentLanguages', []));
  const [processingResults, setProcessingResults] = useState<ProcessorResult[]>(() => loadSession('processingResults', []));
  const [comparison, setComparison] = useState<ComparisonResult | null>(() => loadSession('comparison', null));
  const [executedPipeline, setExecutedPipeline] = useState<PipelineDefinition | null>(() => loadSession('executedPipeline', null));
  const [selectedPipelineMethod, setSelectedPipelineMethod] = useState<string | undefined>(() => loadSession('selectedPipelineMethod', undefined));
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('idp-dark-mode') === 'true');

  useEffect(() => {
    // Unauthenticated / demo mode — assign a default anonymous user.
    // Cognito flow: the backend validates the JWT; the frontend just needs an alias
    // for UI display. A real Cognito integration would fetch /api/auth/me here.
    (async () => {
      try {
        const res = await authedFetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json() as AuthUser;
          setUser(data);
        } else {
          // Unauthenticated mode — use anonymous
          setUser({ alias: 'anonymous', email: '' });
        }
      } catch {
        setUser({ alias: 'anonymous', email: '' });
      }
    })();
  }, []);

  // Persist state to sessionStorage on change
  useEffect(() => { saveSession('document', document); }, [document]);
  useEffect(() => { saveSession('capabilities', selectedCapabilities); }, [selectedCapabilities]);
  useEffect(() => { saveSession('previewData', previewData); }, [previewData]);
  useEffect(() => { saveSession('preferredMethod', preferredMethod); }, [preferredMethod]);
  useEffect(() => { saveSession('documentLanguages', documentLanguages); }, [documentLanguages]);
  useEffect(() => { saveSession('processingResults', processingResults); }, [processingResults]);
  useEffect(() => { saveSession('comparison', comparison); }, [comparison]);
  useEffect(() => { saveSession('executedPipeline', executedPipeline); }, [executedPipeline]);
  useEffect(() => { saveSession('selectedPipelineMethod', selectedPipelineMethod); }, [selectedPipelineMethod]);

  // Dark mode toggle (#16)
  useEffect(() => {
    globalThis.document.body.classList.toggle('awsui-dark-mode', darkMode);
    localStorage.setItem('idp-dark-mode', String(darkMode));
    import('@cloudscape-design/global-styles').then(({ applyMode, Mode }) => {
      applyMode(darkMode ? Mode.Dark : Mode.Light);
    });
  }, [darkMode]);

  const isAdmin = user ? ADMIN_USERS.includes(user.alias) : false;
  const steps = isAdmin
    ? [...STEPS, { href: '/admin', text: 'Admin' }, { href: '/survey-results', text: 'Survey Results' }]
    : STEPS;
  const currentStepIndex = steps.findIndex((s) => s.href === location.pathname);
  const activeStep = currentStepIndex >= 0 ? currentStepIndex : 0;

  // Feedback survey — one-time per user, checked on login.
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [feedbackChecked, setFeedbackChecked] = useState(false);

  useEffect(() => {
    if (!user || feedbackChecked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/feedback/status');
        if (!res.ok) return;
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) return;
        const data = await res.json() as { submitted: boolean };
        if (!cancelled && !data.submitted) {
          // Show after a short delay so it doesn't hijack the initial load
          setTimeout(() => { if (!cancelled) setFeedbackVisible(true); }, 3000);
        }
      } catch {
        // Non-blocking
      } finally {
        if (!cancelled) setFeedbackChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, feedbackChecked]);

  const handleUploadComplete = useCallback(
    (doc: UploadResponse) => {
      // Reset all state for new document
      setDocument(doc);
      setSelectedCapabilities([]);
      setPreviewData(null);
      setPreferredMethod(undefined);
      setDocumentLanguages([]);
      setProcessingResults([]);
      setComparison(null);
      setExecutedPipeline(null);
      setSelectedPipelineMethod(undefined);
      navigate('/conversation');
    },
    [navigate],
  );

  const handleCapabilitiesSelected = useCallback(
    (caps: Capability[]) => setSelectedCapabilities(caps),
    [],
  );

  const handleDocumentLanguagesDetected = useCallback(
    (langs: string[]) => setDocumentLanguages(langs),
    [],
  );

  const handleStartProcessing = useCallback((method?: string, preview?: PreviewResponse | null) => {
    setPreferredMethod(method); // Always set — clears stale value when no method selected
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
    (
      results: ProcessorResult[],
      comp: ComparisonResult,
      pipeline: PipelineDefinition | null,
      preferred?: string,
    ) => {
      setProcessingResults(results);
      setComparison(comp);
      setExecutedPipeline(pipeline);
      setSelectedPipelineMethod(preferred);
    },
    [],
  );

  const handleViewArchitecture = useCallback(() => {
    navigate('/architecture');
  }, [navigate]);

  const handleToggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  // Docs pages have their own layout (left sidebar, no Cloudscape chrome).
  // Render them standalone so /docs never shares the app's stepper navigation.
  if (location.pathname === '/docs' || location.pathname.startsWith('/docs/')) {
    return (
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:slug" element={<DocsPage />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <>
      <TopNav user={user} darkMode={darkMode} onToggleDarkMode={handleToggleDarkMode} />
      <AppLayout
        navigation={
          <SideNav activeStep={activeStep} steps={steps} />
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
                      onDocumentLanguagesDetected={handleDocumentLanguagesDetected}
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
                      documentLanguages={documentLanguages}
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
                      executedPipeline={executedPipeline}
                      selectedPipelineMethod={selectedPipelineMethod}
                    />
                  }
                />
                {isAdmin && (
                  <Route path="/admin" element={<AdminPage />} />
                )}
                {isAdmin && (
                  <Route path="/survey-results" element={<SurveyResultsPage />} />
                )}
              </Routes>
            </Suspense>
          </ErrorBoundary>
        }
        toolsHide
        navigationWidth={260}
      />
      <FeedbackModal
        visible={feedbackVisible}
        onDismiss={() => setFeedbackVisible(false)}
        onSubmitted={() => setFeedbackVisible(false)}
      />
    </>
  );
}
