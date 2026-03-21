# Session 6 - End-to-End Flow Completion Plan

**Type**: Delta from Session 5 state
**Created**: 2026-03-19
**Status**: RALPLAN Consensus Draft
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
3. **No execution summary on PipelinePage** - `totalCost` and `totalLatencyMs` are computed in usePipeline but never displayed. After execution completes, there's no visual confirmation or CTA to proceed.

### Viable Options

**Option A: Wire pipeline results through App.tsx state (CHOSEN)**
- Add `onPipelineComplete` callback from PipelinePage to App.tsx
- App.tsx stores pipeline execution results in existing `processingResults`/`comparison` state
- ArchitecturePage receives data it already expects
- Pros: Minimal change, reuses existing state shape, no new abstractions
- Cons: App.tsx grows as a state container (acceptable for this app size)

**Option B: Shared context/store (React Context or Zustand)**
- Create a shared store for cross-page data flow
- Pros: Cleaner separation, scalable
- Cons: Overengineered for 5 pages, requires refactoring all page props, higher risk
- **Invalidated**: The app has 5 pages with clear linear flow. Prop drilling through App.tsx is the appropriate pattern at this scale.

---

## Task Flow (6 Steps)

### Step 1: Wire Pipeline Execution Results to App.tsx

**Problem**: PipelinePage executes the pipeline successfully, but the results (per-method extractions, costs, latencies) are trapped inside usePipeline state. App.tsx never receives them. ArchitecturePage gets empty `processingResults=[]` and `comparison=null`.

**Changes**:

| File | Change |
|------|--------|
| `packages/frontend/src/App.tsx` | Add `handlePipelineComplete(results, comparison)` callback that sets `processingResults` and `comparison` state. Pass it to PipelinePage as `onPipelineComplete` prop. |
| `packages/frontend/src/pages/PipelinePage.tsx` | Accept `onPipelineComplete` prop. After `pipeline_complete` SSE event, transform pipeline execution results into `ProcessorResult[]` and `ComparisonResult` and call the callback. |
| `packages/frontend/src/hooks/usePipeline.ts` | Expose `executionResults` (the raw per-node results from `node_complete` events) as state so PipelinePage can read them. |

**Key logic**: When `pipeline_complete` fires, PipelinePage must:
1. Collect all `node_complete` results (already stored in nodeStates)
2. Transform them into `ProcessorResult[]` format that ArchitecturePage/ComparisonTable expects
3. Build a `ComparisonResult` from the collected results (use existing `buildComparison` logic or compute client-side)
4. Call `onPipelineComplete(results, comparison)`

**Acceptance Criteria**:
- After pipeline execution completes, navigate to `/architecture` and see data populated (not "No analysis data" alert)
- `processingResults` array has one entry per completed method node
- `comparison` object has method-level metrics (cost, latency)

---

### Step 2: Display Execution Summary + CTA on PipelinePage

**Problem**: After pipeline execution finishes, the user sees completed nodes but no summary and no clear "what next" action. `totalCost` and `totalLatencyMs` are computed but never rendered. The "Generate Code" button at the top exists always, not just after execution.

**Changes**:

| File | Change |
|------|--------|
| `packages/frontend/src/pages/PipelinePage.tsx` | Destructure `totalCost`, `totalLatencyMs` from usePipeline. After `isExecuting` becomes false and there are completed nodes: show an execution summary Container with total cost, total latency, success/error counts. Show a prominent "View Architecture & Code" button. |
| `packages/frontend/src/pages/PipelinePage.tsx` | Move "Generate Code" button from the always-visible header to only appear in the post-execution summary section. |

**Execution Summary Container** (appears after pipeline_complete):
- Total cost: `$X.XXXX`
- Total latency: `X.Xs`
- Methods: `N succeeded, M failed`
- Button: "View Architecture & Code" (primary, calls `onViewArchitecture`)

**Acceptance Criteria**:
- After execution completes, a summary container appears below the canvas
- Summary shows accurate totalCost and totalLatencyMs from the SSE stream
- "View Architecture & Code" button only appears after execution, not before
- Clicking it navigates to `/architecture` with data populated

---

### Step 3: Connect ArchitecturePage to Backend AI Route

**Problem**: ArchitecturePage generates static Python/TypeScript/CDK code client-side. The backend has a `/api/architecture` route that streams AI-generated architecture recommendations with Mermaid diagrams and cost projections, but the frontend never calls it. The page also ignores `processingResults` and `comparison` props for its code generation.

**Changes**:

| File | Change |
|------|--------|
| `packages/frontend/src/hooks/useArchitecture.ts` | NEW file. Hook that calls `POST /api/architecture` via SSE, accumulates streamed text, extracts diagram and cost projections. Returns `{ text, diagram, costProjections, isLoading, error, generate }`. |
| `packages/frontend/src/pages/ArchitecturePage.tsx` | Import and use `useArchitecture`. On mount, if `processingResults.length > 0 && comparison`, auto-call `generate()`. Show streamed AI recommendation above the existing code tabs. Keep existing code generation as a "Code Snippets" section below. |

**New sections on ArchitecturePage** (top to bottom):
1. **AI Architecture Recommendation** - Streamed markdown text from Claude
2. **Architecture Diagram** - Mermaid diagram rendered via `mermaid` library (or as code block if mermaid not available)
3. **Cost Projections** - Table at 3 scales (1K, 10K, 100K docs/month) from backend
4. **Code Snippets** - Existing Python/TypeScript/CDK tabs (unchanged)
5. **Cost Calculator** - Existing interactive calculator (unchanged)

**Fallback**: If `processingResults` is empty (user navigated directly), show the existing static code generation only, with an info alert saying "Run pipeline execution first for AI-powered architecture recommendations."

**Acceptance Criteria**:
- With pipeline results: AI recommendation streams in, diagram displayed, cost projections shown
- Without pipeline results: Static code generation works as before
- No blank page or error in either scenario

---

### Step 4: Improve Step Transitions and Loading States

**Problem**: Transitions between steps are abrupt. No loading feedback during BDA polling (17s+). No indication of what the user should do next at each step.

**Changes**:

| File | Change |
|------|--------|
| `packages/frontend/src/pages/ConversationPage.tsx` | After preview completes, show a prominent "Build Pipeline" CTA box below PreviewComparison, with summary: "Preview analyzed your document with 3 methods. Build a pipeline to run full extraction." |
| `packages/frontend/src/pages/PipelinePage.tsx` | During execution, show per-node progress text (not just spinner). For BDA nodes, show "Polling BDA... (~15-30s)" message. |
| `packages/frontend/src/components/pipeline/nodes/MethodNode.tsx` | When state is 'active', show method-family-specific progress text: BDA="Polling...", Claude/Nova="Streaming...", Textract="OCR + LLM..." |
| `packages/frontend/src/pages/ArchitecturePage.tsx` | Show streaming indicator while AI generates recommendation. |

**Acceptance Criteria**:
- User never sees a blank/frozen screen for more than 2 seconds without feedback
- BDA nodes show "Polling..." not just a spinner
- Each page has a clear "next step" CTA when its work is done
- ConversationPage -> PipelinePage -> ArchitecturePage transitions feel guided

---

### Step 5: Fix ProcessingPage Data Flow (Secondary Path)

**Problem**: ProcessingPage exists as the "Advanced" comparison path, but after it completes, `onComplete` sets `processingResults`/`comparison` in App.tsx, which then... doesn't automatically navigate to architecture. The user must manually click "View Architecture Recommendation". Also, ProcessingPage and PipelinePage both compete for the same result slots.

**Changes**:

| File | Change |
|------|--------|
| `packages/frontend/src/App.tsx` | In `handleProcessingComplete`, add `navigate('/architecture')` after setting state. This auto-navigates after processing completes. |
| `packages/frontend/src/pages/ProcessingPage.tsx` | Remove the manual "View Architecture Recommendation" button since navigation is now automatic. Replace with a brief "Processing complete. Generating architecture..." transition state. |
| `packages/frontend/src/components/layout/SideNav.tsx` | Keep "Processing (Advanced)" as optional in sidebar. No change needed, it's already correctly marked. |

**Acceptance Criteria**:
- Processing page auto-navigates to architecture after all methods complete
- Architecture page receives processingResults and comparison correctly
- Both primary (Pipeline) and secondary (Processing) paths lead to a populated Architecture page

---

### Step 6: Config and Dev Experience Fixes

**Problem**: `.env.example` is stale, ESM dotenv workaround is undocumented, error messages for format restrictions are unclear.

**Changes**:

| File | Change |
|------|--------|
| `.env.example` | Update with current bucket names, all BDA ARN fields, document the `--env-file` flag requirement, add `MIDWAY_DISABLED=true` for local dev. |
| `packages/backend/src/config/aws.ts` | Add validation on startup: log warnings for missing optional configs (BDA ARNs), hard-fail for missing required configs (AWS_REGION). |
| `packages/backend/src/routes/preview.ts` | Add clear error messages when file format is unsupported by a specific method (e.g., "BDA does not support images over 5MB" instead of generic AWS SDK error). |
| `packages/backend/src/adapters/token-stream-adapter.ts` | Wrap Bedrock errors with user-friendly messages (e.g., "Model access not enabled" -> "Please enable Claude Sonnet 4.6 in your Bedrock console"). |

**Acceptance Criteria**:
- New developer can clone repo, copy `.env.example`, fill in values, and start the app
- Missing BDA ARNs produce clear warnings at startup, not runtime crashes
- File format errors show actionable messages, not AWS SDK stack traces

---

## Files Changed Summary

| Category | Files | New |
|----------|-------|-----|
| Frontend Pages | `App.tsx`, `PipelinePage.tsx`, `ArchitecturePage.tsx`, `ProcessingPage.tsx`, `ConversationPage.tsx` | 0 |
| Frontend Hooks | `usePipeline.ts` | `useArchitecture.ts` (1 new) |
| Frontend Components | `MethodNode.tsx`, `SideNav.tsx` | 0 |
| Backend Routes | `preview.ts` | 0 |
| Backend Config | `aws.ts` | 0 |
| Backend Adapters | `token-stream-adapter.ts` | 0 |
| Config | `.env.example` | 0 |
| **Total** | **12 modified** | **1 new** |

---

## Execution Order and Dependencies

```
Step 1 (MUST FIRST) ─── Pipeline results -> App.tsx state
  │
  ├── Step 2 (parallel) ─── Execution summary + CTA on PipelinePage
  │
  └── Step 3 (parallel) ─── ArchitecturePage backend connection
       │
       └── Step 4 (after 2+3) ─── Loading states + transitions
            │
            └── Step 5 (after 4) ─── ProcessingPage data flow
                 │
                 └── Step 6 (last) ─── Config + DX fixes
```

Step 1 is the critical dependency. Steps 2 and 3 can run in parallel after Step 1. Steps 4-6 are incremental polish.

---

## Success Criteria (E2E "Done" Definition)

1. **Upload a PDF** -> auto-navigate to Conversation
2. **AI advisor asks questions** -> recommends capabilities -> auto-preview runs
3. **Click "Build Pipeline"** -> navigate to Pipeline page -> smart pipeline auto-generates
4. **Click "Execute Pipeline"** -> nodes animate, show method-specific progress text, cost/latency appear on completion
5. **Execution summary appears** -> shows total cost, latency, method success counts
6. **Click "View Architecture & Code"** -> navigate to Architecture page with data populated
7. **AI streams architecture recommendation** -> Mermaid diagram, cost projections, code snippets all present
8. **Alternative path**: From Conversation -> ProcessingPage (Advanced) -> auto-navigate to Architecture -> same result

Test with: 1-page PDF receipt, 3-5 capabilities, at least 2 methods (claude-sonnet + nova-lite minimum).

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Pipeline results shape doesn't match ProcessorResult | Medium | High | Step 1 includes explicit transformation logic. Test with real execution. |
| Architecture backend route errors without comparison data | Low | Medium | Fallback to static code generation already exists. |
| Mermaid rendering adds bundle bloat | Low | Low | Render as code block if mermaid not imported. Can add later. |
| BDA polling blocks UI responsiveness | None (already async) | None | Step 4 adds progress text for user comfort. |

---

## ADR

**Decision**: Wire pipeline execution results through App.tsx prop drilling to ArchitecturePage, and connect ArchitecturePage to the existing backend AI route.

**Drivers**: The entire demo story (upload -> analyze -> compare -> architecture) breaks at the Pipeline->Architecture boundary because results don't flow forward. This is the #1 completeness gap.

**Alternatives Considered**:
- React Context/Zustand store: Overengineered for 5 linear pages. Rejected.
- URL params / localStorage: Fragile, doesn't work with complex objects. Rejected.
- Skip pipeline execution, architecture from capabilities only: Already works (current state) but loses the demo impact of showing real execution results feeding into architecture recommendations.

**Why Chosen**: Prop drilling through App.tsx is the established pattern in this codebase. All pages already receive their data as props from App.tsx. Adding one more callback (`onPipelineComplete`) follows the exact same pattern as the existing `onComplete` from ProcessingPage.

**Consequences**: App.tsx becomes a larger state container. Acceptable for current scale. If the app grows beyond 8-10 pages, consider extracting to a context.

**Follow-ups**: After verifying E2E flow, consider adding localStorage persistence for session recovery (user refreshes mid-flow).
