# ONE IDP Session 3 - Implementation Plan (FINAL)

**Type**: Delta from current state (NOT greenfield)
**Created**: 2026-03-18
**Status**: RALPLAN Consensus Round 3
**Timeline**: Phase 1-2 before 4/7 internal webinar, Phase 3-4 post-webinar

---

## RALPLAN-DR Summary

### Principles
1. **Delta-only** - 128+ files exist. This plan describes ONLY what changes.
2. **Webinar-first** - UX polish and cost displays beat backend architecture for demo impact.
3. **Minimal blast radius** - Each phase independently shippable. No phase gates another unless noted.
4. **Honest pricing** - Show real token costs from Bedrock responses, not estimates.
5. **PDF-only scope** - No PPT/XLSX for webinar. PDF is the core IDP use case.

### Decision Drivers
1. **Webinar 4/7-8** - Phase 1 (bugs) and Phase 2 (UX) must land before this.
2. **Pipeline execution broken** - usePipeline.ts:104 sends incomplete payload.
3. **BDA needs guards** - Both BDA methods crash with empty ARNs.

### Chosen: Option A (Phased delta, frontend-fix-first)
- **Rejected**: Option B (Backend-first with mock adapters) - slower to demo-ready, mock adapters add maintenance.

---

## Phase 1: Critical Bug Fixes (Pre-webinar, MUST HAVE)

### 1.1: Fix Pipeline Execution Payload

**Bug**: Frontend sends incomplete payload, backend rejects it.

| Location | Current | Fix |
|----------|---------|-----|
| `packages/frontend/src/hooks/usePipeline.ts:83` | `executePipeline(pipelineDef, documentId)` | Add `s3Uri: string` as 3rd param: `executePipeline(pipelineDef, documentId, s3Uri)` |
| `packages/frontend/src/hooks/usePipeline.ts:104-107` | `body: JSON.stringify({ pipelineId: pipelineDef.id, documentId })` | `body: JSON.stringify({ pipelineId: pipelineDef.id, documentId, s3Uri, pipeline: pipelineDef })` |
| `packages/frontend/src/pages/PipelinePage.tsx:148` | `executePipeline(pipeline, document.documentId)` | `executePipeline(pipeline, document.documentId, document.s3Uri)` |

**Guard**: Add `if (!document?.s3Uri)` early return in PipelinePage before calling executePipeline.

**Acceptance Test**:
```bash
# Start backend + frontend, upload a PDF, generate pipeline, click Execute
# Expected: SSE stream starts, network tab shows POST /api/pipeline/execute with 4 fields
# Expected: Pipeline nodes animate idle -> active -> complete
# Verify: No 400 error in console, no "pipeline_error" SSE event
```

### 1.2: Add BDA Guards

**Bug**: `bda-standard` crashes with empty `BDA_PROFILE_ARN`. `pipeline.ts` has zero BDA guards.

| Location | Guard Condition | Error Message |
|----------|----------------|---------------|
| `packages/backend/src/routes/process.ts:54` (add after existing bda-custom guard) | `m === 'bda-standard' && !config.bdaProfileArn` | "BDA Standard requires BDA_PROFILE_ARN" |
| `packages/backend/src/routes/pipeline.ts:162` (add filter before the method loop) | `method.startsWith('bda-standard') && !config.bdaProfileArn` | Emit `node_error` SSE event |
| `packages/backend/src/routes/pipeline.ts:162` (same location) | `method === 'bda-custom' && !config.bdaProjectArn` | Emit `node_error` SSE event |

**Key distinction**: `bda-standard` needs `bdaProfileArn`, `bda-custom` needs `bdaProjectArn`. Different ARNs.

**Acceptance Test**:
```bash
# Unset BDA_PROFILE_ARN and BDA_PROJECT_ARN, run pipeline with BDA methods
# Expected: BDA nodes show "error" state with clear message (not AWS SDK error)
# Expected: Other method nodes (Claude, Nova, Textract) still execute normally
```

### 1.3: Parallelize Pipeline Execution

**Bug**: `packages/backend/src/routes/pipeline.ts:162` uses sequential `for...of` loop.

**Fix**: Replace with `Promise.allSettled` (same pattern as `process.ts:67-72`).

```typescript
// Before (sequential):
for (const methodNode of methodNodes) {
  await executeMethodNode(methodNode, res, ...);
}

// After (parallel):
await Promise.allSettled(
  methodNodes.map(async (methodNode) => {
    // emit node_start, run processor, emit node_complete/node_error
  })
);
// THEN emit pipeline_complete with accumulated results
```

**SSE ordering**: Events already have `nodeId` field. Frontend at `usePipeline.ts:139-189` switches on `event.nodeId`. Safe for out-of-order arrival. `pipeline_complete` emitted ONLY after `Promise.allSettled` resolves.

**Acceptance Test**:
```bash
# Execute pipeline with 3 method nodes
# Expected: Total execution time ~ max(method_latencies), not sum
# Expected: SSE events arrive interleaved by nodeId
# Expected: pipeline_complete arrives last
```

---

## Phase 2: Cost Optimization + UX (Webinar impact)

### 2.1: Smart Model Routing (Rule-Based Fast Path)

**Current**: `pipeline-smart.ts:84-88` calls Claude for EVERY routing decision (~2s + tokens).

**Fix**: Add short-circuit before Claude call. Reuse existing `selectMethod()` from `pipeline-generator.ts:49-95`.

**Algorithm**:
```
1. Call selectMethod(capability, optimizeFor) for each capability (existing function)
2. For each assignment, check CAPABILITY_SUPPORT[method_family][capability]
3. confidence = count(support == 'excellent' || support == 'good') / total_capabilities
4. If confidence >= 0.7: return rule-based result (skip Claude call, <10ms)
5. If confidence >= 0.5: return rule-based result with rationale noting uncertainty
6. If confidence < 0.5: fall through to Claude call (existing pipeline-smart.ts logic)
```

**Files to modify**:
- `packages/backend/src/routes/pipeline-smart.ts` - Add `tryRuleBasedRouting(body)` before line 84

**Acceptance Test**:
```bash
# Upload simple text document, select 3 capabilities with 'excellent' support
# Expected: /api/pipeline/smart returns in <100ms (no Claude call in server logs)
# Upload complex document with mixed support levels
# Expected: /api/pipeline/smart takes ~2s (Claude call in server logs)
```

### 2.2: Dynamic maxTokens Sizing

**Current**: Hardcoded `maxTokens: 4096` everywhere.

**Formula**:
```typescript
function calculateMaxTokens(capCount: number, pageCount: number, format: 'yaml' | 'json', isMedia: boolean): number {
  if (isMedia) return Math.max(2048, Math.min(capCount * 500, 4096));
  const formatMult = format === 'yaml' ? 1.0 : 1.3;
  const calculated = Math.round((200 * capCount + pageCount * 150) * formatMult);
  return Math.max(512, Math.min(calculated, 4096));
}
// Examples:
// 3 caps, 1 page, yaml  -> max(512, min(750, 4096))  = 750
// 5 caps, 2 pages, yaml -> max(512, min(1300, 4096)) = 1300
// 15 caps, 10 pages, json -> max(512, min(5850, 4096)) = 4096
// media, 2 caps          -> max(2048, min(1000, 4096)) = 2048
```

**Files to modify**:
| File | Line | Change |
|------|------|--------|
| `packages/backend/src/services/token-budget.ts` | NEW | Export `calculateMaxTokens()` |
| `packages/backend/src/routes/preview.ts` | 169 | Import and use instead of hardcoded 4096 |
| `packages/backend/src/adapters/token-stream-adapter.ts` | 68 | Same |
| `packages/backend/src/adapters/two-phase-adapter.ts` | 72 | Same |

**NOT changed** (conversation/agent prompts have different semantics):
- `packages/backend/src/routes/conversation.ts:246` (conversational, not extraction)
- `packages/backend/src/agents/socratic-agent.ts:99` (agent response, not extraction)
- `packages/backend/src/routes/pipeline-smart.ts:87` (routing decision, not extraction)
- `packages/backend/src/routes/architecture.ts:76` (code generation, not extraction)

**Safety**: If `stopReason === 'max_tokens'` in response, log warning: `[token-budget] Output truncated for ${method} (${maxTokens} tokens). Consider raising MIN.`

**Acceptance Test**:
```bash
# Process 1-page receipt with 3 capabilities
# Expected: Server log shows maxTokens=750, not 4096
# Expected: Output NOT truncated (check stopReason in response)
# Process 10-page contract with 15 capabilities
# Expected: maxTokens=4096 (capped)
```

### 2.3: Cost Display on Pipeline Canvas

**Current**: `node_complete` events include `metrics: { latencyMs, cost }` but frontend doesn't display them.

**Files to modify**:
| File | Change |
|------|--------|
| `packages/frontend/src/hooks/usePipeline.ts` | Add `totalCost` state, accumulate from `node_complete` metrics |
| `packages/frontend/src/components/pipeline/PipelineCanvas.tsx` | Render cost+latency as badge on completed method nodes |
| `packages/frontend/src/components/pipeline/PipelineToolbar.tsx` | Show cumulative cost in toolbar after all nodes complete |

**UX**: Per-node cost shown as badge immediately on completion. Cumulative total shown in toolbar ONLY after `pipeline_complete` (avoids confusing partial totals during parallel execution).

**Acceptance Test**:
```bash
# Execute pipeline with 3 methods
# Expected: Each completed node shows "$0.00XXXX" and "XXXms" badge
# Expected: After all complete, toolbar shows "Total: $0.00XXXX"
```

---

## Phase 3: New Capabilities (Post-webinar)

**DEPENDENCY: Step 3.1 MUST complete before 3.2 or 3.3 can start.**

### 3.1: Uniform Page-Image+Text Representation

**New type** in `packages/shared/src/types/unified-page.ts`:
```typescript
interface UnifiedPageResult {
  pageNumber: number;
  text: string;
  tables: Array<{ rows: string[][]; confidence: number }>;
  kvPairs: Array<{ key: string; value: string; confidence: number }>;
  entities: Array<{ type: string; value: string; confidence: number }>;
  metadata: Record<string, unknown>;
}
```

**New service** `packages/backend/src/services/normalizer.ts`: normalizes each adapter's output to `UnifiedPageResult[]`.

**Modified**: `packages/backend/src/processors/processor-base.ts` - call normalizer after `adapter.run()`.

### 3.2: Strands Agent POC (DEFERRABLE)

**Scope**: ONLY `socratic-agent.ts`. Feature-flagged `USE_STRANDS_AGENT=false` (default off).
- Rename current to `socratic-agent-legacy.ts`
- New `socratic-agent-strands.ts` using Strands SDK
- Router in `agents/index.ts` checks env var

### 3.3: JSON Schema Document Classes

**New directory** `packages/shared/src/schemas/` with 3 built-in schemas (invoice, receipt, generic).
**New service** `packages/backend/src/services/schema-loader.ts`.
**New component** `packages/frontend/src/components/conversation/SchemaSelector.tsx`.

---

## Phase 4: Polish + Tech Debt (Post-webinar)

### 4.1: Error Handling
- Bedrock client retry config: 3 retries with exponential backoff for 429s
- Timeout: 120s for LLM adapters, 600s for BDA adapter
- React Error Boundaries wrapping each page

### 4.2: Local Dev Mocks
- `MOCK_AWS=true` env var
- Canned responses in `packages/backend/src/mocks/`
- All 4 pages work E2E without AWS credentials

### 4.3: Bundle Splitting + Responsive
- React.lazy() for page components
- Vite manual chunks (cloudscape, reactflow, marked)
- Target: initial bundle < 500KB

### 4.4: Backend Hardening
- Rate limiting: 10 req/min for process/preview
- CORS: restrict to `FRONTEND_URL` in production
- Unit tests for services/ (>60% coverage target)

### 4.5: Remaining UX (if time)
- Skeleton loaders, dark mode toggle, conversation save (localStorage), onboarding wizard

---

## Risk Assessment

| Risk | Likelihood | Impact | Concrete Mitigation |
|------|-----------|--------|-------------------|
| Pipeline payload fix breaks state flow | Low | High | Change is additive (adding fields). No existing fields removed. Rollback: `git revert`. |
| Dynamic maxTokens truncates output | Medium | Medium | MIN=512 (media=2048). Log on `stopReason=max_tokens`. Bump MIN reactively. |
| Rule-based routing picks wrong method | Medium | Low | Falls through to Claude at confidence < 0.5. Rule-based is fast path, not replacement. |
| BDA ARN empty causes crash | None (fixed) | None | Guard checks empty string. Valid ARN users unaffected. |
| Parallel SSE event ordering | Low | Medium | Events have nodeId. Frontend already handles out-of-order. Total cost shown only after pipeline_complete. |
| BDA concurrency throttling | Medium | Low | BDA methods are typically 0-2 per pipeline. If throttled, retry in adapter handles it. |
| Strands SDK incompatibility | Medium | None | Feature-flagged off. Legacy agent is fallback. Phase 3 item. |

---

## Parallel Worker Assignment

```
Phase 1 (2 workers, ~2 days):
  Worker A: Step 1.1 (pipeline payload fix) + Step 1.3 (parallelize execution)
    Files: usePipeline.ts, PipelinePage.tsx, pipeline.ts
  Worker B: Step 1.2 (BDA guards)
    Files: process.ts, pipeline.ts (non-overlapping section)

Phase 2 (2 workers, ~3 days):
  Worker A: Step 2.1 (smart routing) + Step 2.2 (dynamic maxTokens)
    Files: pipeline-smart.ts, token-budget.ts (new), preview.ts, adapters/
  Worker B: Step 2.3 (cost display)
    Files: PipelineCanvas.tsx, PipelineToolbar.tsx, usePipeline.ts (totalCost state only)

Phase 3 (sequential 3.1, then parallel 3.2/3.3):
  Worker A: Step 3.1 (uniform representation) -- FIRST
  Then parallel:
    Worker B: Step 3.2 (Strands POC)
    Worker C: Step 3.3 (JSON Schema classes)

Phase 4 (3 workers):
  Worker A: Steps 4.1 + 4.3 (error handling + bundle splitting)
  Worker B: Step 4.2 + 4.4 (mocks + backend hardening)
  Worker C: Step 4.5 (remaining UX)
```

---

## ADR

**Decision**: Phased delta with Phase 1 (bugs) -> Phase 2 (cost UX) -> Phase 3 (capabilities) -> Phase 4 (polish).

**Drivers**: Webinar 4/7-8, broken pipeline execution, cost comparison is the demo differentiator.

**Rejected**: Backend-first mock strategy (delays demo), Strands-first migration (risk without demo benefit), PPT/XLSX support (not core IDP use case for webinar).

**Consequences**: Strands deferred, no PPT/XLSX, no mocks for local dev until Phase 4. Team needs AWS credentials.

**Follow-ups**: After webinar feedback, evaluate file format support and Strands migration scope.
