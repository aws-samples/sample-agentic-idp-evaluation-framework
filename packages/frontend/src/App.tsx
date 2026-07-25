import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import AppLayout from '@cloudscape-design/components/app-layout';
import Spinner from '@cloudscape-design/components/spinner';
import Box from '@cloudscape-design/components/box';
import type { UploadResponse, Capability, ProcessorResult, ComparisonResult, PipelineDefinition } from '@idp/shared';
import { getDocumentType, getRunStage } from '@idp/shared';
import TopNav from './components/layout/TopNav';
import SideNav from './components/layout/SideNav';
import ErrorBoundary from './components/common/ErrorBoundary';
import { DemoFooterNote } from './components/common/DemoDisclaimer';
import ResumeBanner from './components/common/ResumeBanner';
import StepGate from './components/common/StepGate';
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
const RecentRunsPage = lazy(() => import('./pages/RecentRunsPage'));
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

/**
 * Recent Runs is conditional, not part of the four-step flow.
 *
 * On a shared deployment without per-user authentication every visitor resolves to
 * the same alias, so a stored run list would show one person's uploaded documents to
 * the next visitor. The server refuses those endpoints in that state
 * (`GET /api/health/features` → `runHistoryDisabled`); hiding this entry keeps the UI
 * from advertising a feature that would 403, and is NOT itself the security control.
 */
const RUN_HISTORY_STEP = { href: '/runs', text: 'Recent Runs' };

const ADMIN_USERS = (import.meta.env.VITE_ADMIN_USERS || '').split(',').filter(Boolean);

/**
 * Client-side workflow state.
 *
 * Uses localStorage rather than sessionStorage: sessionStorage is scoped to a
 * single tab and is discarded when that tab closes, so closing the tab (or
 * opening the app in a second one) silently lost an in-progress evaluation.
 * localStorage survives both, and the server-side run id (see `runId` below)
 * lets a completed evaluation be re-fetched even if this cache is cleared or the
 * backend restarts — the run itself lives in DynamoDB, not in the browser.
 *
 * Writes are guarded: a quota failure must never break the app, and a corrupt
 * entry must not wedge it on every future load.
 */
const STATE_PREFIX = 'idp-';

function loadSession<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(`${STATE_PREFIX}${key}`);
    if (saved == null) return fallback;
    return JSON.parse(saved) as T;
  } catch {
    // Corrupt entry — drop it so it cannot fail again on the next load.
    try { localStorage.removeItem(`${STATE_PREFIX}${key}`); } catch { /* ignore */ }
    return fallback;
  }
}

function saveSession(key: string, value: unknown) {
  try {
    if (value == null) {
      localStorage.removeItem(`${STATE_PREFIX}${key}`);
      return;
    }
    localStorage.setItem(`${STATE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Quota exceeded. Results can be large; keeping the app usable matters more
    // than caching them, and the run is still recoverable from the server.
  }
}

/**
 * Keys that describe the current evaluation. Everything here is discarded by
 * "Start over".
 *
 * Listed explicitly rather than clearing every `idp-`-prefixed key: the wildcard
 * version also deleted user PREFERENCES that happen to share the prefix, so
 * starting a new evaluation re-showed the onboarding banner someone had already
 * dismissed. Preferences are not workflow state.
 */
const WORKFLOW_KEYS = [
  'document',
  'capabilities',
  'previewData',
  'preferredMethod',
  'documentLanguages',
  'processingResults',
  'comparison',
  'executedPipeline',
  'selectedPipelineMethod',
  'runId',
] as const;

/** Clear all workflow state — used when starting a fresh evaluation. */
function clearWorkflowState() {
  try {
    for (const key of WORKFLOW_KEYS) {
      localStorage.removeItem(`${STATE_PREFIX}${key}`);
    }
  } catch { /* ignore */ }
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
  // Server-side id of the last completed run. Persisted so a refresh — or a
  // browser cache clear, or a backend restart — can re-fetch the run from
  // DynamoDB instead of losing the evaluation entirely.
  const [runId, setRunId] = useState<string | null>(() => loadSession('runId', null));

  useEffect(() => {
    (async () => {
      // Midway OIDC — @idp/midway resolves to real module or no-op stub via vite alias.
      if (import.meta.env.VITE_AUTH_PROVIDER === 'midway') {
        const { initMidwayAuth } = await import('@idp/midway');
        const midwayUser = initMidwayAuth();
        if (midwayUser) {
          setUser(midwayUser);
        }
        return;
      }

      // Cognito / none — fetch user from backend
      try {
        const res = await authedFetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json() as AuthUser;
          setUser(data);
        } else {
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
  useEffect(() => { saveSession('runId', runId); }, [runId]);

  // Dark mode toggle (#16)
  useEffect(() => {
    globalThis.document.body.classList.toggle('awsui-dark-mode', darkMode);
    localStorage.setItem('idp-dark-mode', String(darkMode));
    import('@cloudscape-design/global-styles').then(({ applyMode, Mode }) => {
      applyMode(darkMode ? Mode.Dark : Mode.Light);
    });
  }, [darkMode]);

  const isAdmin = user ? ADMIN_USERS.includes(user.alias) : false;
  /*
   * Default to DISABLED until the server says otherwise: if the flag fetch fails we
   * must not advertise history we may not be allowed to read. Failing closed is the
   * right direction for a disclosure control.
   */
  const [runHistoryDisabled, setRunHistoryDisabled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health/features')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setRunHistoryDisabled(!!d.runHistoryDisabled); })
      .catch(() => { /* stay disabled */ });
    return () => { cancelled = true; };
  }, []);

  const baseSteps = runHistoryDisabled ? STEPS : [...STEPS, RUN_HISTORY_STEP];
  const steps = isAdmin
    ? [...baseSteps, { href: '/admin', text: 'Admin' }, { href: '/survey-results', text: 'Survey Results' }]
    : baseSteps;
  const currentStepIndex = steps.findIndex((s) => s.href === location.pathname);
  const activeStep = currentStepIndex >= 0 ? currentStepIndex : 0;

  // Real completion state, derived from what actually exists — not from the URL.
  // Deep-linking to a later step must not claim earlier steps are done.
  const completedHrefs = useMemo(() => {
    const done = new Set<string>();
    if (document) done.add('/');
    if (document && selectedCapabilities.length > 0) done.add('/conversation');
    // Step 3 is the PIPELINE step, so it is complete only when a pipeline was
    // actually executed. `processingResults.length > 0` was also true for a
    // preview-only run (and for any run loaded from Recent Runs), which marked
    // Pipeline "Done" for a pipeline that was never built — and clicking it
    // landed on an empty canvas.
    if (executedPipeline && processingResults.length > 0) done.add('/pipeline');
    if (comparison) done.add('/architecture');
    return done;
  }, [document, selectedCapabilities, processingResults, comparison, executedPipeline]);

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
        const data = await res.json() as { submitted: boolean; available?: boolean };
        // `available: false` means the feedback table is not provisioned, so
        // there is nowhere to store a response — do not prompt for one.
        if (!cancelled && !data.submitted && data.available !== false) {
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
      // Clear the previous document's run id too. Without this, uploading a
      // second document left the first document's runId in localStorage, and the
      // ResumeBanner then offered to restore a run belonging to a file the user
      // had already replaced.
      setRunId(null);
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
    if (preview) {
      setPreviewData(preview);
      // A preview is a saved run in its own right (source: 'preview'), so keep its
      // id. Previously only pipeline execution set runId, meaning a user who
      // previewed and then cleared their browser storage lost all trace of it even
      // though the results were sitting in DynamoDB.
      if (preview.runId) setRunId(preview.runId);
    }
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
      completedRunId?: string | null,
    ) => {
      setProcessingResults(results);
      setComparison(comp);
      setExecutedPipeline(pipeline);
      setSelectedPipelineMethod(preferred);
      if (completedRunId) setRunId(completedRunId);
    },
    [],
  );

  /** Discard the current evaluation and start clean. */
  const handleStartOver = useCallback(() => {
    clearWorkflowState();
    setDocument(null);
    setSelectedCapabilities([]);
    setPreviewData(null);
    setPreferredMethod(undefined);
    setDocumentLanguages([]);
    setProcessingResults([]);
    setComparison(null);
    setExecutedPipeline(null);
    setSelectedPipelineMethod(undefined);
    setRunId(null);
    navigate('/');
  }, [navigate]);

  const handleViewArchitecture = useCallback(() => {
    navigate('/architecture');
  }, [navigate]);

  const handleToggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  const handleLoadRun = useCallback(async (loadRunId: string) => {
    try {
      const res = await authedFetch(`/api/runs/${loadRunId}`);
      if (!res.ok) throw new Error('Failed to load run');
      const run = await res.json() as {
        documentId: string;
        documentName: string;
        s3Uri?: string;
        fileSize?: number;
        pageCount?: number;
        capabilities: string[];
        documentLanguages?: string[];
        results: any[];
        comparison: any;
        source: string;
        pipelineDefinition?: any;
        selectedPipelineMethod?: string;
        preferredMethod?: string;
      };

      /*
       * Replace the whole evaluation, do not merge into it.
       *
       * Each field used to be restored only `if (run.x)`, so anything the loaded
       * run did not carry kept the value from whatever the user was looking at
       * before. Loading a preview-only run after a pipeline run therefore showed
       * the previous document's comparison, pipeline canvas and run id attributed
       * to the newly loaded document — and /architecture would generate code for
       * methods that run never used. Every field is now assigned unconditionally.
       */
      setDocument({
        documentId: run.documentId,
        s3Uri: run.s3Uri ?? '',
        fileName: run.documentName,
        fileSize: run.fileSize ?? 0,
        pageCount: run.pageCount ?? 0,
        previewUrl: '',
        // Re-derive documentType from the file name. It is not stored on the run
        // record, and PipelinePage's auto-generate needs it: with it undefined,
        // neither generation branch fired, so opening step 3 after loading a run
        // showed an empty page with no canvas, no error and no spinner.
        documentType: getDocumentType(run.documentName) ?? undefined,
      });
      setSelectedCapabilities(run.capabilities as Capability[]);
      setDocumentLanguages(run.documentLanguages ?? []);
      setProcessingResults((run.results ?? []) as ProcessorResult[]);
      setComparison((run.comparison ?? null) as ComparisonResult | null);
      setExecutedPipeline((run.pipelineDefinition ?? null) as PipelineDefinition | null);
      setSelectedPipelineMethod(run.selectedPipelineMethod);
      setPreferredMethod(run.preferredMethod);
      // The loaded run IS the current run; carrying the old id forward would
      // report this evaluation under a different run's identifier.
      setRunId(loadRunId);
      // previewData belongs to a live preview stream, not to a stored run.
      setPreviewData(null);

      /*
       * Land on the step the run actually reached.
       *
       * This sent every run without a comparison back to /conversation, so a
       * pipeline that executed but whose comparison was missing dropped the user
       * two steps back with the executed canvas invisible. `getRunStage` derives
       * the resume point from the record's contents, and the Recent Runs button
       * already names that destination — so the label and the navigation cannot
       * disagree.
       */
      navigate(getRunStage(run).resumeHref);
    } catch (err) {
      console.error('[LoadRun] Failed:', err);
    }
  }, [navigate]);

  // Docs pages have their own layout (left sidebar, no Cloudscape chrome).
  // Render them standalone so /docs never shares the app's stepper navigation.
  if (location.pathname === '/docs' || location.pathname.startsWith('/docs/')) {
    return (
      <>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/docs/:slug" element={<DocsPage />} />
          </Routes>
        </Suspense>
        <DemoFooterNote />
      </>
    );
  }

  return (
    <>
      <TopNav user={user} darkMode={darkMode} onToggleDarkMode={handleToggleDarkMode} />
      <AppLayout
        navigation={
          <SideNav activeStep={activeStep} steps={steps} completedHrefs={completedHrefs} />
        }
        content={
          <ErrorBoundary>
            <Suspense fallback={<PageSpinner />}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <>
                      {document && !runHistoryDisabled && (
                        <Box padding={{ bottom: 'l' }}>
                          <ResumeBanner
                            fileName={document.fileName}
                            capabilityCount={selectedCapabilities.length}
                            hasResults={processingResults.length > 0}
                            runId={runId}
                            onContinue={() => navigate(
                              processingResults.length > 0 ? '/architecture' : '/conversation',
                            )}
                            onStartOver={handleStartOver}
                          />
                        </Box>
                      )}
                      <HomePage onUploadComplete={handleUploadComplete} />
                    </>
                  }
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
                      // Restores a completed preview after a refresh instead of
                      // re-running (and re-paying for) every method.
                      previewData={previewData}
                      onPreviewComplete={setPreviewData}
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
                {/*
                  Direct-URL /runs must not render either. The page would only show
                  403s, but more importantly nothing should present run history as an
                  available feature when the server is refusing it. The catch-all 404
                  below handles the path instead.
                */}
                {!runHistoryDisabled && (
                  <Route
                    path="/runs"
                    element={<RecentRunsPage onLoadRun={handleLoadRun} isAdmin={isAdmin} />}
                  />
                )}
                {isAdmin && (
                  <Route path="/admin" element={<AdminPage onLoadRun={handleLoadRun} />} />
                )}
                {isAdmin && (
                  <Route path="/survey-results" element={<SurveyResultsPage />} />
                )}
                {/*
                  Catch-all. Without it, any unmatched path rendered an entirely
                  blank content area with no heading, message or way back — and
                  that included /admin and /survey-results for every non-admin
                  user, since those routes only exist when isAdmin is true.
                */}
                <Route
                  path="*"
                  element={
                    <StepGate
                      heading="Page not found"
                      message="That page isn't available. It may require admin access, or the link may be out of date."
                      actionLabel="Go to Upload"
                      actionHref="/"
                    />
                  }
                />
              </Routes>
            </Suspense>
            {/*
              The demo/no-SLA notice as one quiet line, on every route. The full
              data-handling warning lives with the file picker (UploadDisclaimer)
              where it actually applies; this keeps the "not an AWS product"
              disclosure present after the user has moved past step 1, without a
              full-width banner sitting above every page.
            */}
            <DemoFooterNote />
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
