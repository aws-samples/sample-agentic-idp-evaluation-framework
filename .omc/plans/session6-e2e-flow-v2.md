# Session 6 - End-to-End Flow Completion Plan (v2)

**Type**: Delta from Session 5 state
**Created**: 2026-03-19
**Status**: RALPLAN Consensus — Revised after Critic ITERATE
**Goal**: Make Upload -> Conversation -> Preview -> Pipeline -> Execution -> Results -> Architecture work as one unbroken flow

---

## RALPLAN-DR Summary

### Principles
1. **Flow continuity** - Every page transition must carry forward the data produced by the previous step. No dead ends.
2. **Delta-only** - Session 5 laid the groundwork. This plan only fixes gaps in wiring, not architectural rewrites.
3. **Visible progress** - The user must see cost, latency, and status at every step. Hidden state is a bug.
4. **Graceful degradation** - If pipeline execution partially fails, remaining results still flow forward to architecture.
5. **Single primary flow** - Upload -> Conversation -> Pipeline -> Architecture is the happy path. ProcessingPage is secondary.

### Decision Drivers
1. **Pipeline results don't reach ArchitecturePage** - The #1 blocker. App.tsx only sets `processingResults` from ProcessingPage, never from PipelinePage.
2. **ArchitecturePage never calls the backend** - The backend `/api/architecture` route streams AI-generated architecture recommendations, but the frontend ignores it entirely and generates static code client-side.
3. **No execution summary on PipelinePage** - `totalCost` and `totalLatencyMs` are computed in usePipeline but never displayed.

### Viable Options

**Option A: Backend builds comparison, sends in pipeline_complete (CHOSEN)**
- Backend `pipeline.ts` builds `ComparisonResult` using existing `buildComparison()` from `services/comparison.ts`
- Backend includes `comparison` and per-method `ProcessorResult[]` in the `pipeline_complete` SSE event
- Frontend stores both from `pipeline_complete` — no client-side comparison logic needed
- Pros: Reuses proven comparison code, single source of truth, no duplication
- Cons: Slightly larger SSE payload for pipeline_complete event (acceptable)

**Option B: Frontend builds comparison from node_complete results**
- Frontend collects results from `node_complete` events, transforms them, builds comparison client-side
- Pros: No backend changes to pipeline_complete
- Cons: Duplicates `buildComparison()` logic, must extract method name from nodeId (fragile), violates DRY
- **Invalidated**: `buildComparison()` already exists on the backend and is used by `/process`. Duplicating it client-side adds complexity and drift risk.

---

## Task Flow (7 Steps — Step 0 is parallel with all others)

### Step 0: BDA+LLM Adapter (Parallel Workstream — Backend Only)

**Problem**: No adapter exists for BDA extraction followed by LLM enrichment. This is the "best of both worlds" approach (BDA's structured extraction + LLM's reasoning).

**New File**: `packages/backend/src/adapters/bda-llm-adapter.ts`

**Pattern**: Follow `TwoPhaseAdapter` at `packages/backend/src/adapters/two-phase-adapter.ts`:
- Phase 1: BDA extraction — reuse `SyncPollAdapter` logic from `packages/backend/src/adapters/sync-poll-adapter.ts` (invoke BDA async, poll for completion, fetch S3 output)
- Phase 2: LLM enrichment — send BDA raw output + capabilities to `ConverseStream` (same pattern as `TwoPhaseAdapter` lines 54-105)

**Class**: `BdaLlmAdapter implements StreamAdapter`
- Constructor takes `method: ProcessingMethod` (one of the new BDA+LLM methods)
- `run()`:
  1. Call `emitProgress(res, this.method, 'all', 0, 'Invoking BDA...')`
  2. Invoke BDA async (copy from `SyncPollAdapter.run()` lines 24-43)
  3. Poll for completion (copy from `SyncPollAdapter.run()` lines 48-73)
  4. Fetch raw BDA output (reuse `SyncPollAdapter.fetchOutput()` private method — extract to shared helper or duplicate)
  5. `emitProgress(res, this.method, 'all', 50, 'BDA complete. Enriching with LLM...')`
  6. Build LLM prompt: "Given this BDA extraction output, enrich and structure for capabilities: [caps]. Return JSON."
  7. Stream via `ConverseStreamCommand` using `this.modelId` (from `METHOD_INFO[this.method].modelId`)
  8. Return `AdapterOutput`

**New Processors**: Add to `packages/backend/src/processors/` — create a `bda-llm.ts` file:
```
BdaClaudeSonnetProcessor  (method: 'bda-claude-sonnet')
BdaClaudeHaikuProcessor   (method: 'bda-claude-haiku')
BdaNovaLiteProcessor      (method: 'bda-nova-lite')
```
Each extends `ProcessorBase`, sets `this.adapter = new BdaLlmAdapter(method)`.

**Shared type changes** — `packages/shared/src/types/processing.ts`:
- Add to `METHODS` array (line 5): `'bda-claude-sonnet'`, `'bda-claude-haiku'`, `'bda-nova-lite'`
- Add corresponding `METHOD_INFO` entries with:
  - `family: 'bda-llm'` (NEW family)
  - `tokenPricing`: BDA page cost + LLM token cost (use the LLM's pricing)
  - `estimatedCostPerPage`: BDA $0.01 + LLM per-page estimate
- Add `'bda-llm'` to `METHOD_FAMILIES` array (line 22)
- Add `CAPABILITY_SUPPORT['bda-llm']` entry (copy from `bda` but upgrade claude-backed caps to `excellent`)

**Register in pipeline.ts**: Add to `PROCESSOR_MAP` in `packages/backend/src/routes/pipeline.ts` (line 34):
```typescript
'bda-claude-sonnet': () => new BdaClaudeSonnetProcessor(),
'bda-claude-haiku': () => new BdaClaudeHaikuProcessor(),
'bda-nova-lite': () => new BdaNovaLiteProcessor(),
```

**Register in process.ts**: Same addition to `PROCESSOR_MAP` at `packages/backend/src/routes/process.ts` (line 14).

**No frontend changes needed** — the pipeline generator and UI already handle any `ProcessingMethod` dynamically.

**Acceptance Criteria**:
- `BdaLlmAdapter` compiles and follows `StreamAdapter` interface
- New processors registered in both `pipeline.ts` and `process.ts` PROCESSOR_MAP
- New methods appear in shared types and can be selected by the pipeline generator
- Build passes: `npm run build` in all 3 packages

---

### Step 1: Wire Pipeline Execution Results to App.tsx

**Problem**: PipelinePage executes the pipeline, but results are trapped in `usePipeline` state. App.tsx never receives them. ArchitecturePage gets `processingResults=[]` and `comparison=null`.

**CRITICAL FIX — NodeStateInfo discards results**: `usePipeline.ts` line 12-17 defines `NodeStateInfo` with no `result` field. The `node_complete` handler at line 165-172 only stores `state` and `metrics`, discarding `event.result`. Meanwhile, the backend DOES send `result` in node_complete events (see `pipeline.ts` line 215: `result: result.results`).

**CRITICAL FIX — nodeId is NOT the method name**: Pipeline node IDs are generated strings like `"method-claude-sonnet-1"`, not `ProcessingMethod` values. To get the method name, you must look up the node config: `pipeline.nodes.find(n => n.id === nodeId)?.config` and cast to `MethodNodeConfig` to read `.method`.

**KEY DESIGN DECISION**: The backend builds `ComparisonResult` in `pipeline_complete` event using existing `buildComparison()`. Frontend just stores the pre-built objects.

#### Changes:

**File: `packages/shared/src/types/pipeline.ts` (line 117)**
Change `pipeline_complete` event type from:
```typescript
| { type: 'pipeline_complete'; results: unknown; totalCost: number; totalLatencyMs: number }
```
To:
```typescript
| { type: 'pipeline_complete'; results: ProcessorResult[]; comparison: ComparisonResult; totalCost: number; totalLatencyMs: number }
```
Add imports at top: `import type { ProcessorResult, ComparisonResult } from './processing.js';`

**File: `packages/backend/src/routes/pipeline.ts`**

1. Add import (top): `import { buildComparison } from '../services/comparison.js';`

2. After `Promise.allSettled` (line 239), build ProcessorResult[] and ComparisonResult before emitting pipeline_complete. Replace lines 241-248 with:

```typescript
// Build ProcessorResult[] from settled promises
const processorResults: ProcessorResult[] = [];
for (let i = 0; i < validMethodNodes.length; i++) {
  const s = settled[i];
  if (s.status === 'fulfilled' && s.value) {
    const methodConfig = validMethodNodes[i].config as MethodNodeConfig;
    processorResults.push({
      method: methodConfig.method,
      status: 'complete',
      results: s.value.results,
      metrics: s.value.metrics,
      rawOutput: s.value.rawOutput,
    });
  }
}

const comparison = buildComparison(processorResults);

const totalLatencyMs = Date.now() - startTime;
emitSSE(res, {
  type: 'pipeline_complete',
  results: processorResults,
  comparison,
  totalCost,
  totalLatencyMs,
} as PipelineExecutionEvent);
```

Add import: `import type { MethodNodeConfig } from '@idp/shared';`

Note: `ProcessorBase.process()` returns `ProcessorResult` (see `processor-base.ts` line 14). The `result` var in the map callback (line 222) is already a `ProcessorResult`.

**File: `packages/frontend/src/hooks/usePipeline.ts`**

1. Add `result` field to `NodeStateInfo` (line 12):
```typescript
export interface NodeStateInfo {
  state: NodeState;
  progress?: number;
  metrics?: { latencyMs: number; cost: number };
  error?: string;
  result?: Record<string, unknown>;  // NEW: raw capability results from node_complete
}
```

2. Update `node_complete` handler (line 165) to store `event.result`:
```typescript
case 'node_complete':
  setNodeStates((prev) => ({
    ...prev,
    [event.nodeId]: {
      state: 'complete',
      metrics: event.metrics,
      result: event.result as Record<string, unknown>,  // NEW
    },
  }));
```

3. Add new state for pipeline-complete results (after line 44):
```typescript
const [completionData, setCompletionData] = useState<{
  results: ProcessorResult[];
  comparison: ComparisonResult;
} | null>(null);
```
Import `ProcessorResult, ComparisonResult` from `@idp/shared`.

4. Update `pipeline_complete` handler (line 196) to store completion data:
```typescript
case 'pipeline_complete':
  if (event.totalCost != null) setTotalCost(event.totalCost);
  if (event.totalLatencyMs != null) setTotalLatencyMs(event.totalLatencyMs);
  setCompletionData({
    results: (event as any).results as ProcessorResult[],
    comparison: (event as any).comparison as ComparisonResult,
  });
  setIsExecuting(false);
  break;
```

5. Expose `completionData` in the return value. Add to `UsePipelineResult` interface (line 19):
```typescript
completionData: { results: ProcessorResult[]; comparison: ComparisonResult } | null;
```
Add to return object (line 235):
```typescript
completionData,
```

6. Reset `completionData` in `executePipeline` (after line 92):
```typescript
setCompletionData(null);
```

**File: `packages/frontend/src/pages/PipelinePage.tsx`**

1. Update `PipelinePageProps` interface (line 19) to add:
```typescript
onPipelineComplete: (results: ProcessorResult[], comparison: ComparisonResult) => void;
```
Import `ProcessorResult, ComparisonResult` from `@idp/shared`.

2. Destructure `completionData` from `usePipeline()` (line 43):
```typescript
const { ..., completionData } = usePipeline();
```

3. Add effect to call `onPipelineComplete` when completionData arrives:
```typescript
useEffect(() => {
  if (completionData) {
    onPipelineComplete(completionData.results, completionData.comparison);
  }
}, [completionData, onPipelineComplete]);
```

**File: `packages/frontend/src/App.tsx`**

1. Add `handlePipelineComplete` callback (after line 90):
```typescript
const handlePipelineComplete = useCallback(
  (results: ProcessorResult[], comp: ComparisonResult) => {
    setProcessingResults(results);
    setComparison(comp);
  },
  [],
);
```

2. Pass to PipelinePage (line 130-136):
```tsx
<PipelinePage
  document={document}
  capabilities={selectedCapabilities}
  previewData={previewData}
  preferredMethod={preferredMethod}
  onViewArchitecture={handleViewArchitecture}
  onPipelineComplete={handlePipelineComplete}  // NEW
/>
```

**Acceptance Criteria**:
- After pipeline execution completes, `processingResults` and `comparison` are populated in App.tsx state
- Navigate to `/architecture` and see data populated (not "No analysis data" alert)
- `processingResults` array has one entry per completed method node with correct `method` field (e.g., `'claude-sonnet'`, not `'method-claude-sonnet-1'`)
- `comparison` object has method-level metrics (cost, latency, ranks)

---

### Step 2: Display Execution Summary + CTA on PipelinePage (parallel with Step 3)

**Problem**: After pipeline execution finishes, the user sees completed nodes but no summary and no clear "what next" action.

**MINOR FIX from Critic**: Keep "Generate Code" button visible in header (line 198). Do NOT relocate it. The post-execution summary adds a SECOND prominent CTA.

**Changes**:

**File: `packages/frontend/src/pages/PipelinePage.tsx`**

1. Destructure `totalCost`, `totalLatencyMs`, `completionData` from usePipeline (already done in Step 1).

2. After the PipelineAlternatives section (after line 349), add an execution summary Container that renders when `completionData` is not null and `!isExecuting`:

```tsx
{/* Execution Summary — shown after pipeline_complete */}
{completionData && !isExecuting && (
  <Container
    header={
      <Header variant="h2">Execution Results</Header>
    }
  >
    <SpaceBetween size="m">
      <ColumnLayout columns={4} variant="text-grid">
        <div>
          <Box variant="awsui-key-label">Total Cost</Box>
          <Box variant="awsui-value-large">${totalCost.toFixed(4)}</Box>
        </div>
        <div>
          <Box variant="awsui-key-label">Total Latency</Box>
          <Box variant="awsui-value-large">{(totalLatencyMs / 1000).toFixed(1)}s</Box>
        </div>
        <div>
          <Box variant="awsui-key-label">Methods Succeeded</Box>
          <Box variant="awsui-value-large">
            {completionData.results.filter(r => r.status === 'complete').length}
          </Box>
        </div>
        <div>
          <Box variant="awsui-key-label">Methods Failed</Box>
          <Box variant="awsui-value-large">
            {Object.values(nodeStates).filter(n => n.state === 'error').length}
          </Box>
        </div>
      </ColumnLayout>
      <Box textAlign="center" padding={{ top: 's' }}>
        <Button variant="primary" iconName="external" onClick={onViewArchitecture}>
          View Architecture & Code
        </Button>
      </Box>
    </SpaceBetween>
  </Container>
)}
```

**Acceptance Criteria**:
- After execution completes, a summary container appears below the canvas
- Summary shows accurate totalCost and totalLatencyMs
- "View Architecture & Code" CTA appears only after execution
- "Generate Code" button remains in the header at all times (unchanged from current)
- Clicking CTA navigates to `/architecture` with data populated

---

### Step 3: Connect ArchitecturePage to Backend AI Route (parallel with Step 2)

**Problem**: ArchitecturePage generates static code client-side. The backend has a `/api/architecture` route that streams AI recommendations, but the frontend never calls it. Also, `architecture.ts:116` crashes if `comparison` is null.

**CRITICAL FIX — Backend null guard**: `packages/backend/src/routes/architecture.ts` line 116 does `body.comparison.methods.map(...)` which crashes if `comparison` is null/undefined.

**Changes**:

**File: `packages/backend/src/routes/architecture.ts` (line 116)**

Replace:
```typescript
costData.methods = body.comparison.methods.map((m) => ({
```
With:
```typescript
costData.methods = (body.comparison?.methods ?? []).map((m) => ({
```

Also add null guard at the top of the route handler (after line 39):
```typescript
if (!body.processingResults || body.processingResults.length === 0) {
  emitSSE(res, { type: 'text', data: 'No processing results provided. Please run pipeline execution first.' });
  emitSSE(res, { type: 'done' });
  endSSE(res, keepalive);
  return;
}
```

**File: `packages/frontend/src/hooks/useArchitecture.ts` (NEW)**

Create a hook that calls `POST /api/architecture` via SSE:

```typescript
import { useState, useCallback, useRef } from 'react';
import type { ProcessorResult, ComparisonResult, Capability, ArchitectureEvent } from '@idp/shared';

export interface ArchitectureData {
  text: string;
  diagram: string | null;
  costProjections: unknown[];
  isLoading: boolean;
  error: string | null;
}

export function useArchitecture() {
  const [text, setText] = useState('');
  const [diagram, setDiagram] = useState<string | null>(null);
  const [costProjections, setCostProjections] = useState<unknown[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (
    processingResults: ProcessorResult[],
    comparison: ComparisonResult | null,
    capabilities: Capability[],
  ) => {
    abortRef.current?.abort();
    setIsLoading(true);
    setError(null);
    setText('');
    setDiagram(null);
    setCostProjections([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/architecture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processingResults, comparison, capabilities }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Architecture generation failed (${res.status})`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;

          try {
            const event: ArchitectureEvent = JSON.parse(jsonStr);
            switch (event.type) {
              case 'text':
                setText(prev => prev + event.data);
                break;
              case 'diagram':
                setDiagram(event.data as string);
                break;
              case 'cost_projection':
                setCostProjections(prev => [...prev, event.data]);
                break;
              case 'done':
                break;
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { text, diagram, costProjections, isLoading, error, generate };
}
```

**File: `packages/frontend/src/pages/ArchitecturePage.tsx`**

1. Import and use `useArchitecture` hook.
2. On mount, if `processingResults.length > 0`, auto-call `generate()`.
3. Add AI recommendation section above existing code tabs.
4. Keep all existing static code generation (unchanged).
5. If no processingResults, show existing page as-is with info alert.

Add to top of component (after line 291):
```typescript
const { text: aiText, diagram, costProjections, isLoading: aiLoading, error: aiError, generate } = useArchitecture();

useEffect(() => {
  if (processingResults.length > 0 && !aiText && !aiLoading && !aiError) {
    generate(processingResults, comparison, capabilities);
  }
}, [processingResults, comparison, capabilities, generate, aiText, aiLoading, aiError]);
```

Add new sections BEFORE the existing "Pipeline Architecture" Container (before line 375):
```tsx
{/* AI Architecture Recommendation */}
{(aiLoading || aiText) && (
  <Container
    header={
      <Header variant="h2" description="AI-generated based on your actual processing results">
        Architecture Recommendation
      </Header>
    }
  >
    <SpaceBetween size="m">
      {aiLoading && <Spinner />}
      {aiText && (
        <div
          className="chat-markdown"
          dangerouslySetInnerHTML={{ __html: marked.parse(aiText) as string }}
          style={{ fontSize: '14px', lineHeight: '1.6' }}
        />
      )}
      {diagram && (
        <Box>
          <Box variant="h3">Architecture Diagram</Box>
          <pre style={{ background: '#f4f4f4', padding: '16px', borderRadius: '8px', overflow: 'auto' }}>
            <code>{diagram}</code>
          </pre>
        </Box>
      )}
      {aiError && <Alert type="error">{aiError}</Alert>}
    </SpaceBetween>
  </Container>
)}
```

Import `marked` and add `Spinner` to imports. Import `useEffect` (already imported).

**Acceptance Criteria**:
- Backend `/api/architecture` does not crash when comparison is null
- With pipeline results: AI recommendation streams in, diagram displayed as code block
- Without pipeline results: Static code generation works as before
- No blank page or error in either scenario

---

### Step 4: Improve Step Transitions and Loading States

**Problem**: Transitions between steps are abrupt. No loading feedback during BDA polling (17s+).

**Changes**:

**File: `packages/frontend/src/components/pipeline/nodes/MethodNode.tsx`**

When node state is `'active'`, show method-family-specific progress text instead of just a spinner:
- BDA/BDA-LLM family: "Polling BDA... (~15-30s)"
- Claude/Nova family: "Streaming response..."
- Textract-LLM family: "OCR + LLM processing..."

The method family can be determined from `node.config`: cast to `MethodNodeConfig`, read `.family`.

**File: `packages/frontend/src/pages/PipelinePage.tsx`**

During execution (`isExecuting === true`), show a progress bar or text below the canvas:
```tsx
{isExecuting && (
  <Box textAlign="center" color="text-body-secondary" padding={{ top: 's' }}>
    Executing pipeline... {Object.values(nodeStates).filter(n => n.state === 'complete').length} / {Object.values(nodeStates).length} nodes complete
  </Box>
)}
```

**File: `packages/frontend/src/pages/ArchitecturePage.tsx`**

Already handled in Step 3 — `aiLoading` shows a Spinner while AI generates.

**Acceptance Criteria**:
- BDA nodes show "Polling BDA..." not just a spinner
- User sees node completion count during execution
- Each page has clear loading indicators

---

### Step 5: Fix ProcessingPage Data Flow (parallel with Steps 2/3, NOT sequential after Step 4)

**Problem**: ProcessingPage doesn't auto-navigate to architecture after completion.

**Changes**:

**File: `packages/frontend/src/App.tsx`**

In `handleProcessingComplete` (line 85-90), add navigation:
```typescript
const handleProcessingComplete = useCallback(
  (results: ProcessorResult[], comp: ComparisonResult) => {
    setProcessingResults(results);
    setComparison(comp);
    navigate('/architecture');  // NEW: auto-navigate
  },
  [navigate],
);
```

**File: `packages/frontend/src/pages/ProcessingPage.tsx`**

Remove any manual "View Architecture Recommendation" button since navigation is now automatic. (If present — check component for a button calling `onViewArchitecture`.)

**Acceptance Criteria**:
- Processing page auto-navigates to architecture after all methods complete
- Both Pipeline and Processing paths lead to populated Architecture page

---

### Step 6: Config and Dev Experience Fixes

**Problem**: `.env.example` is stale, architecture route crashes on missing data.

**Changes**:

**File: `.env.example`**

Update with:
```
AWS_REGION=us-west-2
S3_BUCKET=your-bucket-name
S3_PREFIX=uploads/
S3_OUTPUT_PREFIX=outputs/
BDA_PROFILE_ARN=
BDA_PROJECT_ARN=
BDA_BLUEPRINT_ARN=
MIDWAY_DISABLED=true
# Start: npm run dev (uses --env-file .env)
```

**File: `packages/backend/src/config/aws.ts`**

Add startup validation: log warnings for missing BDA ARNs, hard-fail for missing `AWS_REGION`.

**File: `packages/backend/src/adapters/token-stream-adapter.ts`**

Wrap Bedrock errors with user-friendly messages (e.g., "Model access not enabled" -> "Please enable [model] in Bedrock console").

**Acceptance Criteria**:
- New developer can clone, copy `.env.example`, fill values, start app
- Missing BDA ARNs produce warnings at startup, not runtime crashes

---

## Execution Order and Dependencies

```
Step 0 (PARALLEL) ──────── BDA+LLM Adapter (backend only, independent)

Step 1 (MUST FIRST) ────── Pipeline results -> App.tsx state
  |
  +-- Step 2 (parallel) ── Execution summary + CTA on PipelinePage
  |
  +-- Step 3 (parallel) ── ArchitecturePage backend connection + null guards
  |
  +-- Step 5 (parallel) ── ProcessingPage auto-navigate
  |
  +-- Step 4 (after 2) ─── Loading states + transitions (needs summary UI from Step 2)
       |
       +-- Step 6 (last) ── Config + DX fixes
```

Step 0 has ZERO dependencies on other steps — pure backend.
Step 1 is the critical frontend dependency. Steps 2, 3, 5 can run in parallel after Step 1. Step 4 depends on Step 2's UI being in place. Step 6 is polish.

---

## Files Changed Summary

| Category | Files | New |
|----------|-------|-----|
| Shared Types | `types/pipeline.ts`, `types/processing.ts` | 0 |
| Backend Adapters | `sync-poll-adapter.ts` (reference only) | `bda-llm-adapter.ts` (1 new) |
| Backend Processors | — | `bda-llm.ts` (1 new) |
| Backend Routes | `pipeline.ts`, `architecture.ts`, `process.ts` | 0 |
| Backend Services | `comparison.ts` (reference only) | 0 |
| Frontend Hooks | `usePipeline.ts` | `useArchitecture.ts` (1 new) |
| Frontend Pages | `App.tsx`, `PipelinePage.tsx`, `ArchitecturePage.tsx`, `ProcessingPage.tsx` | 0 |
| Frontend Components | `MethodNode.tsx` | 0 |
| Config | `.env.example`, `config/aws.ts`, `token-stream-adapter.ts` | 0 |
| **Total** | **~12 modified** | **3 new** |

---

## Success Criteria (E2E "Done" Definition)

1. **Upload a PDF** -> auto-navigate to Conversation
2. **AI advisor asks questions** -> recommends capabilities -> auto-preview runs
3. **Click "Build Pipeline"** -> navigate to Pipeline page -> smart pipeline auto-generates
4. **Click "Execute Pipeline"** -> nodes animate, show method-specific progress text (BDA: "Polling...", Claude: "Streaming...")
5. **Execution summary appears** -> shows total cost, latency, success/fail counts
6. **Click "View Architecture & Code"** -> navigate to Architecture page with data populated
7. **AI streams architecture recommendation** -> diagram, cost projections, code snippets all present
8. **Alternative path**: ProcessingPage -> auto-navigate to Architecture -> same result
9. **BDA+LLM methods available**: `bda-claude-sonnet`, `bda-claude-haiku`, `bda-nova-lite` selectable in pipeline

Test with: 1-page PDF receipt, 3-5 capabilities, at least 2 methods (claude-sonnet + nova-lite minimum).

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Backend `buildComparison` changes pipeline_complete payload size | Low | Low | ProcessorResult[] is already serializable; SSE handles large payloads fine |
| Architecture backend route errors without comparison data | Medium | High | **Fixed**: Null guards added in Step 3 |
| BDA+LLM adapter polling + streaming takes >60s | Medium | Low | Set MAX_POLL_ATTEMPTS=60 (5min), same as SyncPollAdapter |
| `pipeline_complete` type change breaks existing frontend | None | None | Frontend currently ignores `results` field; adding typed fields is additive |
| nodeId -> method lookup fails for custom node IDs | Low | High | **Fixed**: Backend now sends full ProcessorResult[] in pipeline_complete, no frontend lookup needed |

---

## ADR

**Decision**: Backend builds `ComparisonResult` in `pipeline_complete` event using existing `buildComparison()`. Frontend stores pre-built results from the SSE event. BDA+LLM adapter added as new adapter following TwoPhaseAdapter pattern.

**Drivers**: (1) Pipeline results must reach ArchitecturePage — the #1 E2E blocker. (2) `buildComparison()` already exists on backend and is used by `/process` — reuse, don't duplicate. (3) BDA+LLM is a high-value demo method showing AWS service composition.

**Alternatives Considered**:
- Frontend builds comparison from node_complete events: Rejected. Would duplicate `buildComparison()` logic and require fragile nodeId-to-method lookups.
- React Context/Zustand store: Overengineered for 5 linear pages. Rejected.
- Skip BDA+LLM adapter: Could be deferred, but it's isolated backend work with high demo value. Included as parallel Step 0.

**Why Chosen**: Backend-built comparison reuses proven code, eliminates the nodeId lookup problem entirely, and matches the existing pattern used by `/process`. Prop drilling through App.tsx is the established pattern in this codebase.

**Consequences**: `pipeline_complete` SSE payload grows to include `ProcessorResult[]` and `ComparisonResult`. This is acceptable — the data is already computed, and SSE handles it fine. App.tsx grows by one callback (`handlePipelineComplete`), same pattern as existing `handleProcessingComplete`.

**Follow-ups**: After verifying E2E flow, consider localStorage persistence for session recovery (user refreshes mid-flow). Consider adding Mermaid rendering library for diagram visualization (currently rendered as code block).
