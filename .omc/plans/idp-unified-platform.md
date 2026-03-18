# IDP Unified Platform - Implementation Plan

**Created:** 2026-03-17
**Revised:** 2026-03-17 (RALPLAN iteration 2 -- Architect/Critic feedback applied)
**Target:** `idp.sanghwa.people.aws.dev`
**Timeline:** Build complete ~3/31, Internal demo 4/7-8

---

## RALPLAN-DR Summary

### Principles (5)

1. **Agent-First Architecture**: Every intelligent interaction flows through Strands Agents. The Socratic question flow, capability routing, and architecture recommendations are all agent-driven, not hardcoded logic.
2. **Real-time Progress Everywhere**: Every processing method communicates progress in real-time via SSE. For true streaming methods (Claude, Nova), this means token-by-token delivery. For async methods (BDA), this means heartbeat + polling progress events via `SyncPollAdapter`. The UI never shows a spinner without progress context.
3. **Parallel-by-Default Processing**: All document processing methods execute concurrently. The comparison dashboard populates incrementally as each method completes.
4. **Cloudscape-Native UI**: Every component uses Cloudscape Design System, including Cloudscape native charting (`BarChart`, `MixedLineBarChart`, `PieChart` from `@cloudscape-design/components`). GenAI interactions use `@cloudscape-design/chat-components`. No custom design tokens, no third-party UI or charting libraries.
5. **Reference-Informed, Clean-Sheet Build**: Existing repo projects (servrx, IDP workbench) are patterns to learn from, but the new platform is built fresh in a monorepo with TypeScript end-to-end.

### Decision Drivers (Top 3)

1. **Demo Readiness by 4/7**: Two-week timeline demands phased delivery. Core flow (upload -> process -> compare) must work before polish.
2. **Real-time User Experience**: The demo impact depends on visible streaming -- watching results populate live across methods is the key differentiator.
3. **Strands SDK Adoption**: This is a showcase for Strands Agents TS SDK. The agent architecture must be idiomatic (tools, streaming, multi-agent patterns from SDK v0.6.0).

### Viable Options

#### Option A: Monolithic Backend with Strands Agent Orchestrator (CHOSEN)

Single Node.js Express server with Strands agents embedded. One SSE endpoint streams all events.

**Pros:**
- Simplest deployment (single process)
- Natural fit for Strands SDK (agents run in-process)
- Fastest to build for demo timeline
- Easy to deploy to AgentCore Runtime (single Dockerfile)

**Cons:**
- CPU-bound processing could block event loop (mitigated by async AWS SDK calls)
- Harder to scale individual processing methods independently

#### Option B: Microservice Backend with Agent Gateway

Separate services for each processing method, coordinated by a gateway agent.

**Pros:**
- Independent scaling per method
- Better fault isolation
- Cleaner separation of concerns

**Cons:**
- Significantly more infrastructure complexity
- Inter-service communication overhead
- Overkill for demo timeline
- **INVALIDATED**: Two-week timeline makes this impractical. The demo needs a working system, not a production-scale architecture. Option A can be refactored later.

### ADR

- **Decision**: Monolithic backend with embedded Strands agents, SSE streaming with StreamAdapter abstraction, React+Cloudscape frontend, containerized for AgentCore
- **Drivers**: Demo timeline, streaming UX, Strands SDK showcase
- **Alternatives considered**: Microservice backend (invalidated by timeline), WebSocket instead of SSE (SSE is simpler and sufficient for server-to-client streaming)
- **Why chosen**: Fastest path to working demo while remaining architecturally clean
- **Consequences**: Single process means all methods share resources; acceptable for demo scale. BDA polling is async-simulated streaming, not true token streaming.
- **Follow-ups**: Post-demo, evaluate if AgentCore Runtime deployment needs architectural changes

---

## Monorepo Structure

```
idp-unified-platform/
├── package.json                    # Root workspace config
├── tsconfig.base.json              # Shared TS config
├── Dockerfile                      # AgentCore Runtime deployment
├── agentcore.config.json           # AgentCore deployment configuration
├── .env.example                    # Environment variables template
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types/
│   │       │   ├── capabilities.ts     # 5 capability type definitions
│   │       │   ├── processing.ts       # Processing method types, results
│   │       │   ├── streaming.ts        # SSE event type definitions
│   │       │   └── api.ts              # Request/response contracts
│   │       ├── constants/
│   │       │   ├── capabilities.ts     # Capability enums and metadata
│   │       │   ├── models.ts           # Model IDs, pricing
│   │       │   └── methods.ts          # Processing method definitions
│   │       └── index.ts
│   │
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                # Express server entry point
│   │       ├── config/
│   │       │   └── aws.ts              # AWS client configuration
│   │       ├── routes/
│   │       │   ├── upload.ts           # POST /api/upload
│   │       │   ├── conversation.ts     # POST /api/conversation (SSE)
│   │       │   ├── process.ts          # POST /api/process (SSE)
│   │       │   └── health.ts           # GET /api/health
│   │       ├── agents/
│   │       │   ├── socratic-agent.ts   # Socratic question flow agent
│   │       │   ├── router-agent.ts     # Capability routing agent
│   │       │   ├── architect-agent.ts  # Architecture recommendation agent
│   │       │   └── tools/
│   │       │       ├── analyze-document.ts   # Tool: analyze uploaded doc
│   │       │       ├── recommend-capabilities.ts  # Tool: suggest capabilities
│   │       │       └── generate-architecture.ts   # Tool: produce arch diagram
│   │       ├── processors/
│   │       │   ├── processor-base.ts         # Abstract processor interface
│   │       │   ├── bda-processor.ts          # BDA processor (standard + custom in one)
│   │       │   ├── claude-direct.ts          # Claude direct vision processor
│   │       │   ├── nova-direct.ts            # Nova 2 Pro vision processor
│   │       │   └── textract-llm.ts           # Textract + LLM processor
│   │       ├── adapters/
│   │       │   ├── stream-adapter.ts         # Base StreamAdapter interface
│   │       │   ├── sync-poll-adapter.ts      # BDA: heartbeat during polling, converts final result to stream
│   │       │   ├── token-stream-adapter.ts   # Claude/Nova: maps ConverseStreamCommand events
│   │       │   └── two-phase-adapter.ts      # Textract+LLM: sync extraction then LLM streaming
│   │       ├── services/
│   │       │   ├── s3.ts                     # S3 upload/download
│   │       │   ├── streaming.ts              # SSE event emitter + keepalive
│   │       │   ├── comparison.ts             # Result comparison engine
│   │       │   └── pricing.ts               # Cost calculation
│   │       └── middleware/
│   │           ├── cors.ts
│   │           ├── upload.ts                 # Multer config
│   │           └── error.ts
│   │
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx                       # AppLayout + routing
│           ├── pages/
│           │   ├── HomePage.tsx              # Landing + upload
│           │   ├── ConversationPage.tsx      # Socratic Q&A flow
│           │   ├── ProcessingPage.tsx        # Processing + comparison dashboard
│           │   └── ArchitecturePage.tsx      # Architecture recommendation
│           ├── components/
│           │   ├── upload/
│           │   │   └── DocumentUpload.tsx    # Drag-drop PDF upload
│           │   ├── conversation/
│           │   │   ├── ChatPanel.tsx         # Cloudscape chat components
│           │   │   └── CapabilityCards.tsx   # Recommended capabilities display
│           │   ├── processing/
│           │   │   ├── MethodCard.tsx        # Single method progress/result
│           │   │   ├── ComparisonTable.tsx   # Side-by-side results
│           │   │   ├── MetricsChart.tsx      # Cloudscape BarChart/MixedLineBarChart
│           │   │   └── StreamingResult.tsx   # Real-time result renderer
│           │   ├── architecture/
│           │   │   └── ArchDiagram.tsx       # Architecture recommendation
│           │   └── layout/
│           │       ├── TopNav.tsx
│           │       └── SideNav.tsx
│           ├── hooks/
│           │   ├── useSSE.ts                 # SSE connection hook (with reconnect)
│           │   ├── useConversation.ts        # Chat state management
│           │   └── useProcessing.ts          # Processing state management
│           └── services/
│               └── api.ts                    # API client
```

---

## Phase Breakdown

### Phase 1: Foundation (Days 1-3)

**Goal:** Monorepo scaffolding, backend server running, frontend shell rendering, file upload working end-to-end. BDA Custom Blueprint prerequisite verified.

#### Step 1.0: Prerequisite Check

Before any code is written, verify:
- [ ] AWS account has Bedrock model access for Claude Sonnet 4 and Nova 2 Pro
- [ ] S3 bucket exists or can be created
- [ ] **BDA Custom Blueprint**: Check if a BDA project with custom blueprints exists (`BDA_PROJECT_ARN`). If no blueprint exists, BDA Custom is **deferrable** -- the MVP works with 4 methods (BDA Standard, Claude Direct, Nova Direct, Textract+LLM). BDA Custom can be added post-demo when blueprints are configured.

#### Step 1.1: Monorepo Setup
- Initialize npm workspace with `packages/{shared,backend,frontend}`
- Configure TypeScript with project references
- Set up shared types package
- Install core dependencies:
  - Backend: `express`, `@strands-agents/sdk`, `@aws-sdk/client-*`, `multer`, `zod`, `cors`
  - Frontend: `react`, `vite`, `@cloudscape-design/components`, `@cloudscape-design/chat-components`, `@cloudscape-design/global-styles`, `react-router-dom`
  - Shared: `zod` (for shared schemas)

**Acceptance Criteria:**
- `npm install` from root installs all workspaces
- `npm run dev -w packages/backend` starts Express on :3001
- `npm run dev -w packages/frontend` starts Vite on :5173
- Shared types importable from both packages

#### Step 1.2: File Upload Pipeline
- Backend: `POST /api/upload` accepts PDF via multer, uploads to S3, returns `{ documentId, s3Uri, metadata }`
- Frontend: `DocumentUpload.tsx` with Cloudscape `FileUpload` component, drag-and-drop support
- S3 service with presigned URL generation for document preview

**Acceptance Criteria:**
- User can drag-and-drop a PDF
- File uploads to S3 bucket
- Backend returns documentId for subsequent processing
- Upload progress shown in UI

#### Step 1.3: Frontend Shell
- `App.tsx` with Cloudscape `AppLayout`, `TopNavigation`, `SideNavigation`
- Page routing: Home -> Conversation -> Processing -> Architecture
- Wizard-style flow using Cloudscape `Wizard` or step indicators

**Acceptance Criteria:**
- All 4 pages render with proper navigation
- Cloudscape theme applied globally
- Responsive layout works

---

### Phase 2: Socratic Agent Flow (Days 4-6)

**Goal:** Strands Agent asks targeted questions about document processing needs, streams responses, recommends capabilities.

#### Step 2.0: Strands SDK Event Type Spike (First 2 hours of Day 4)

Before wiring the streaming conversation endpoint, conduct a focused spike to determine actual Strands SDK streaming event types and shapes:

1. Create a minimal test script that calls `agent.stream()` (or equivalent) and logs raw event objects
2. Document the actual event type names (do NOT assume `contentBlockDelta`/`toolUse` -- these are speculative)
3. Define the `StrandsEventAdapter` interface that normalizes SDK events into our SSE protocol
4. All streaming code wraps SDK events through this adapter so SDK changes are isolated to one file

**Acceptance Criteria:**
- Documented list of actual Strands SDK v0.6.0 streaming event types
- `StrandsEventAdapter` adapter file created in `packages/backend/src/adapters/`
- All subsequent agent streaming code uses the adapter, never raw SDK events

#### Step 2.1: Socratic Question Agent

```typescript
// packages/backend/src/agents/socratic-agent.ts
import { Agent, BedrockModel, tool } from '@strands-agents/sdk'
import { z } from 'zod'

const analyzeDocumentTool = tool({
  name: 'analyze_document',
  description: 'Analyze an uploaded document to understand its structure and content types',
  inputSchema: z.object({
    s3Uri: z.string(),
    documentId: z.string(),
  }),
  callback: async (input) => {
    // Use Textract DetectDocumentText for quick analysis
    // Return: page count, detected content types, has tables, has forms, has images
  },
})

const recommendCapabilitiesTool = tool({
  name: 'recommend_capabilities',
  description: 'Based on user answers and document analysis, recommend the optimal capability combination',
  inputSchema: z.object({
    userNeeds: z.array(z.string()),
    documentFeatures: z.object({
      hasTables: z.boolean(),
      hasForms: z.boolean(),
      hasImages: z.boolean(),
      hasHandwriting: z.boolean(),
      pageCount: z.number(),
    }),
  }),
  callback: async (input) => {
    // Return ranked capabilities with rationale
  },
})

export function createSocraticAgent() {
  const model = new BedrockModel({
    modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    maxTokens: 2048,
  })

  return new Agent({
    model,
    printer: false,
    systemPrompt: `You are an IDP (Intelligent Document Processing) advisor.
Your goal is to understand the user's document processing needs through targeted questions.

Ask ONE question at a time. After 3-5 questions, use the recommend_capabilities tool.

The 5 capabilities you can recommend:
1. Table Extraction - nested tables, table-to-HTML/CSV
2. Key-Value Pair Extraction - structured fields from forms
3. Image/Chart Description - visual content analysis
4. Bounding Box Detection - spatial element detection
5. Free-form Text Extraction - including handwritten text

Start by using analyze_document to understand what the document contains,
then ask clarifying questions about the user's specific needs.`,
    tools: [analyzeDocumentTool, recommendCapabilitiesTool],
  })
}
```

**Acceptance Criteria:**
- Agent analyzes uploaded document automatically
- Asks 3-5 targeted questions (not generic)
- Questions adapt based on document content
- Final recommendation includes capability rationale

#### Step 2.2: Streaming Conversation Endpoint

```typescript
// POST /api/conversation - SSE endpoint
// Request: { documentId, message, conversationHistory }
// Response: SSE stream with events:
//   { type: 'text', data: 'partial text...' }
//   { type: 'tool_use', data: { tool: 'analyze_document', input: {...} } }
//   { type: 'tool_result', data: { tool: 'analyze_document', result: {...} } }
//   { type: 'recommendation', data: { capabilities: [...], rationale: '...' } }
//   { type: 'done', data: { conversationId } }
```

Implementation uses `agent.stream()` through the `StrandsEventAdapter`:

```typescript
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
})

// Keepalive every 15 seconds
const keepalive = setInterval(() => {
  res.write(': keepalive\n\n')
}, 15_000)

try {
  // NOTE: Actual event names TBD from SDK spike (Step 2.0).
  // All SDK events are normalized through StrandsEventAdapter.
  const adapter = new StrandsEventAdapter()
  for await (const event of agent.stream(userMessage)) {
    const normalized = adapter.normalize(event)
    if (normalized) {
      res.write(`data: ${JSON.stringify(normalized)}\n\n`)
    }
  }
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
} finally {
  clearInterval(keepalive)
  res.end()
}
```

**Acceptance Criteria:**
- Agent responses stream token-by-token to frontend
- Tool use events visible in UI (e.g., "Analyzing your document...")
- Conversation history maintained across messages
- Frontend renders chat bubbles with streaming text via Cloudscape chat components
- SSE keepalive sent every 15 seconds

#### Step 2.3: Chat UI with Cloudscape GenAI Components
- Use `@cloudscape-design/chat-components` for the conversation panel
- Show capability recommendation cards using Cloudscape `Cards` component
- User can accept/modify recommended capabilities before proceeding

**Acceptance Criteria:**
- Chat panel with user/assistant message bubbles
- Streaming text renders smoothly (no flicker)
- Capability cards show name, description, relevance score
- User can toggle capabilities on/off
- "Start Processing" button enabled after recommendation

---

### Phase 3: Parallel Processing Engine (Days 7-10)

**Goal:** All processing methods execute in parallel, streaming results via SSE through StreamAdapters.

#### Step 3.0: StreamAdapter Implementation

Implement the three adapter types before building processors:

```typescript
// packages/backend/src/adapters/stream-adapter.ts
export interface StreamAdapter {
  /** Yields normalized SSE events for the frontend */
  stream(
    s3Uri: string,
    capabilities: string[],
    onProgress: (event: ProcessingEvent) => void
  ): AsyncGenerator<ProcessingEvent>
}
```

**Three adapter implementations:**

| Adapter | Used By | Behavior |
|---------|---------|----------|
| `SyncPollAdapter` | BDA (standard + custom) | Sends heartbeat events every 5s during async polling. Converts final S3 result into a stream of capability results. |
| `TokenStreamAdapter` | Claude Direct, Nova Direct | Maps `ConverseStreamCommand` response stream events to our SSE protocol. |
| `TwoPhaseAdapter` | Textract+LLM | Phase 1: sync Textract call with progress events. Phase 2: LLM streaming to structure Textract output. |

**Acceptance Criteria:**
- Each adapter type can be instantiated and tested independently
- `SyncPollAdapter` emits heartbeat events during polling
- `TokenStreamAdapter` maps Converse stream events correctly
- `TwoPhaseAdapter` chains sync and streaming phases

#### Step 3.1: Processor Implementations

Each processor implements a common interface:

```typescript
// packages/backend/src/processors/processor-base.ts
export interface ProcessorResult {
  method: string
  status: 'pending' | 'processing' | 'complete' | 'error'
  results: Record<string, CapabilityResult>  // keyed by capability
  metrics: {
    latencyMs: number
    cost: number
    confidence?: number  // 0-1, self-reported LLM confidence (NOT accuracy)
  }
  rawOutput?: string
}

export interface CapabilityResult {
  capability: string
  data: any           // capability-specific output
  confidence: number  // 0-1, self-reported
  format: 'html' | 'csv' | 'json' | 'text' | 'image'
}

export abstract class ProcessorBase {
  abstract readonly method: string
  abstract readonly adapter: StreamAdapter
  abstract process(
    s3Uri: string,
    capabilities: string[],
    onProgress: (event: ProcessingEvent) => void
  ): Promise<ProcessorResult>
}
```

**4-5 Processor Implementations:**

| Processor | AWS Services | How It Works |
|-----------|-------------|--------------|
| `bda-processor.ts` | BDA Runtime | Single `InvokeDataAutomationAsyncCommand`. If `BDA_PROJECT_ARN` is set, invokes with custom project ARN and extracts both standard output (`document.representation`) AND custom output (`inference_result` + `explainability_info`). If no project ARN, standard output only. One processor, one API call, two output paths. Uses `SyncPollAdapter`. |
| `claude-direct.ts` | Bedrock Runtime (Claude Sonnet 4) | `ConverseStreamCommand` with `document` content block (PDF bytes, `format: 'pdf'`). System prompt instructs capability-specific extraction. Multi-page PDFs sent as document type, not images. Uses `TokenStreamAdapter`. |
| `nova-direct.ts` | Bedrock Runtime (Nova 2 Pro) | `ConverseStreamCommand` with Nova 2 Pro (`us.amazon.nova-2-pro-preview-20251202-v1:0`). For bounding boxes: specific prompt for spatial detection with coordinate output. Uses `TokenStreamAdapter`. **Note:** Verify Nova 2 Pro supports `document` content type; if not, convert PDF pages to images. |
| `textract-llm.ts` | Textract + Bedrock Runtime | `AnalyzeDocumentCommand` (Tables, Forms, Queries features). Then `ConverseStreamCommand` to structure Textract output per capabilities. Uses `TwoPhaseAdapter`. |

**Capability-to-Service Mapping:**

| Capability | BDA (Standard) | BDA (Custom) | Claude Direct | Nova Direct | Textract+LLM |
|-----------|---------------|-------------|--------------|------------|--------------|
| Table Extraction | `document.representation` parsed for tables | Blueprint with table fields | Vision prompt: "Extract all tables as HTML" | Vision prompt: same | `AnalyzeDocument` FeatureType=TABLES + LLM formatting |
| KV Extraction | Text output + LLM structuring | Blueprint with KV fields | Vision prompt: "Extract key-value pairs as JSON" | Vision prompt: same | `AnalyzeDocument` FeatureType=FORMS |
| Image/Chart Description | Limited (text-only) | Blueprint with image fields | Vision prompt: "Describe all images and charts" | Vision prompt: same | Not supported natively, LLM describes from OCR context |
| Bounding Box Detection | Not supported | Not supported | Limited (text coords) | **Primary**: "Return bounding boxes as JSON [{label, x, y, w, h}]" | `AnalyzeDocument` Block geometry |
| Free-form Text | `document.representation.text` | Blueprint text fields | Vision prompt: "Extract all text including handwritten" | Vision prompt: same | `DetectDocumentText` raw output |

**Acceptance Criteria:**
- Each processor can be invoked independently
- Each processor streams progress events via its StreamAdapter
- BDA processor handles async invocation + polling + S3 result fetch (standard and custom output paths)
- Claude/Nova processors stream via `ConverseStreamCommand`
- Textract processor chains Textract output into LLM structuring
- All processors return normalized `ProcessorResult` with `confidence` (not `accuracy`)

#### Step 3.2: Parallel Orchestration + SSE Stream

```typescript
// POST /api/process - SSE endpoint
// Request: { documentId, s3Uri, capabilities: string[], methods: string[] }
// Response: SSE stream with events per method:
//   { type: 'method_start', method: 'claude-direct' }
//   { type: 'method_progress', method: 'claude-direct', data: { capability: 'table_extraction', partial: '...' } }
//   { type: 'method_complete', method: 'claude-direct', data: ProcessorResult }
//   { type: 'method_error', method: 'bda-standard', error: '...' }
//   { type: 'comparison_update', data: ComparisonResult }  // sent after each method completes
//   { type: 'all_complete', data: { results: ProcessorResult[], comparison: ComparisonResult } }
```

Implementation:

```typescript
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
})

// Keepalive every 15 seconds to prevent connection drops
const keepalive = setInterval(() => {
  res.write(': keepalive\n\n')
}, 15_000)

const processors = selectedMethods.map(m => getProcessor(m))
const results: ProcessorResult[] = []

try {
  // Run all processors in parallel
  await Promise.allSettled(
    processors.map(async (proc) => {
      emitSSE(res, { type: 'method_start', method: proc.method })
      try {
        const result = await proc.process(s3Uri, capabilities, (event) => {
          emitSSE(res, { type: 'method_progress', method: proc.method, data: event })
        })
        results.push(result)
        emitSSE(res, { type: 'method_complete', method: proc.method, data: result })
        // Update comparison after each completion
        emitSSE(res, { type: 'comparison_update', data: buildComparison(results) })
      } catch (error) {
        emitSSE(res, { type: 'method_error', method: proc.method, error: error.message })
      }
    })
  )

  emitSSE(res, { type: 'all_complete', data: { results, comparison: buildComparison(results) } })
} finally {
  clearInterval(keepalive)
  res.end()
}
```

**Acceptance Criteria:**
- All selected methods start simultaneously
- Each method's progress streams independently
- Comparison updates incrementally as methods complete
- Errors in one method do not block others
- SSE connection stays open until all methods finish
- Keepalive prevents connection timeout for long BDA polls

#### Step 3.3: Comparison Engine

```typescript
// packages/backend/src/services/comparison.ts
export interface ComparisonResult {
  methods: {
    method: string
    metrics: { latencyMs: number; cost: number; confidence: number }
    rank: { speed: number; cost: number; confidence: number; overall: number }
  }[]
  recommendation: string  // "Best overall: Claude Direct (highest confidence at moderate cost)"
  capabilityMatrix: Record<string, Record<string, { supported: boolean; quality: string }>>
}
```

**Acceptance Criteria:**
- Ranks methods by speed, cost, confidence, and overall score
- Produces per-capability quality assessment
- Generates human-readable recommendation text

---

### Phase 4: Comparison Dashboard UI (Days 9-12)

**Goal:** Production-quality dashboard showing real-time comparison results with Cloudscape components.

#### Step 4.1: Processing Progress View
- `MethodCard.tsx`: Shows each method's status (pending/processing/complete/error)
- Real-time progress indicators per capability within each method
- Cloudscape `StatusIndicator`, `ProgressBar`, `ExpandableSection`

#### Step 4.2: Comparison Dashboard
- `ComparisonTable.tsx`: Cloudscape `Table` with methods as rows, metrics as columns
- `MetricsChart.tsx`: Cloudscape `BarChart` for confidence/cost/speed comparison, `MixedLineBarChart` for combined views, `PieChart` for cost breakdown. All from `@cloudscape-design/components` -- **no Recharts or third-party charting**.
- Side-by-side result viewer: for each capability, show what each method extracted
- `StreamingResult.tsx`: Renders partial results as they stream in

#### Step 4.3: Result Detail Views
- Table extraction: Rendered HTML table with highlighting
- KV extraction: Structured JSON viewer
- Image description: Text alongside original image region
- Bounding boxes: Canvas overlay on document image showing detected regions
- Free-form text: Formatted text with handwriting indicators

**Acceptance Criteria:**
- Dashboard populates in real-time as methods complete
- Metrics charts update incrementally using Cloudscape native chart components
- Side-by-side comparison scrolls in sync
- Each capability result has appropriate specialized renderer
- Cloudscape components throughout (no raw HTML tables, no third-party charting)
- Responsive layout for demo projection

---

### Phase 5: Architecture Recommendation + Deployment + Polish (Days 11-14)

**Goal:** Agent generates best-practice architecture recommendation. Containerize for AgentCore. Final polish for demo.

#### Step 5.1: Architecture Recommendation Agent

```typescript
export function createArchitectAgent() {
  return new Agent({
    model: new BedrockModel({ modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0' }),
    printer: false,
    systemPrompt: `You are an AWS Solutions Architect specializing in IDP.
Based on the processing results comparison, generate:
1. Recommended architecture for the user's use case
2. Which processing method(s) to use for each capability
3. Cost projection at scale (100, 1000, 10000 docs/month)
4. Architecture diagram description (mermaid format)
5. Implementation next steps

Consider the actual benchmark results provided.`,
    tools: [generateArchitectureTool],
  })
}
```

**Acceptance Criteria:**
- Architecture recommendation based on actual processing results
- Cost projections at multiple scales
- Mermaid diagram rendered in UI
- Streaming output for recommendation text

#### Step 5.2: AgentCore Containerization

- `Dockerfile` at monorepo root: multi-stage build (build frontend -> serve from Express static)
- `agentcore.config.json` with runtime configuration (memory, timeout, health check)
- Docker build produces a single container that runs the full application
- Health check endpoint at `GET /api/health`

```dockerfile
# Dockerfile (outline)
FROM node:20-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --workspaces
RUN npm run build -w packages/shared
RUN npm run build -w packages/frontend
RUN npm run build -w packages/backend

FROM node:20-slim AS runtime
WORKDIR /app
COPY --from=build /app/packages/backend/dist ./dist
COPY --from=build /app/packages/frontend/dist ./public
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

**Acceptance Criteria:**
- `docker build` succeeds
- Container starts and serves both API and frontend
- Health check returns 200
- AgentCore config file specifies resource requirements

#### Step 5.3: Demo Polish
- Loading states and error handling for all flows
- Smooth transitions between pages
- Sample documents bundled for demo
- Environment configuration for demo AWS account
- One-command startup (`npm run dev` from root)

**Acceptance Criteria:**
- Complete flow works end-to-end: upload -> questions -> process -> compare -> architecture
- No unhandled errors in happy path
- UI looks production-grade
- Demo can run from a single terminal
- Container deployment tested locally

---

## API Contracts

### `POST /api/upload`
```typescript
// Request: multipart/form-data with 'document' field (PDF)
// Response:
{
  documentId: string
  s3Uri: string
  fileName: string
  fileSize: number
  pageCount: number
  previewUrl: string  // presigned S3 URL
}
```

### `POST /api/conversation` (SSE)
```typescript
// Request:
{
  documentId: string
  message: string
  history: { role: 'user' | 'assistant', content: string }[]
}
// SSE Events:
{ type: 'text', data: string }
{ type: 'tool_use', data: { name: string, input: any } }
{ type: 'tool_result', data: { name: string, result: any } }
{ type: 'recommendation', data: { capabilities: CapabilityRecommendation[] } }
{ type: 'done' }
// Keepalive: `: keepalive\n\n` every 15 seconds
```

### `POST /api/process` (SSE)
```typescript
// Request:
{
  documentId: string
  s3Uri: string
  capabilities: ('table_extraction' | 'kv_extraction' | 'image_description' | 'bounding_box' | 'text_extraction')[]
  methods: ('bda-standard' | 'bda-custom' | 'claude-direct' | 'nova-direct' | 'textract-llm')[]
}
// SSE Events:
{ type: 'method_start', method: string }
{ type: 'method_progress', method: string, data: { capability: string, progress: number, partial?: string } }
{ type: 'method_complete', method: string, data: ProcessorResult }
{ type: 'method_error', method: string, error: string }
{ type: 'comparison_update', data: ComparisonResult }
{ type: 'all_complete', data: { results: ProcessorResult[], comparison: ComparisonResult } }
// Keepalive: `: keepalive\n\n` every 15 seconds
```

### `POST /api/architecture` (SSE)
```typescript
// Request:
{
  documentId: string
  processingResults: ProcessorResult[]
  comparison: ComparisonResult
  capabilities: string[]
}
// SSE Events:
{ type: 'text', data: string }
{ type: 'diagram', data: string }  // mermaid code
{ type: 'cost_projection', data: CostProjection }
{ type: 'done' }
// Keepalive: `: keepalive\n\n` every 15 seconds
```

---

## Strands Agent Architecture

```
                    +------------------+
                    |   Frontend UI    |
                    +--------+---------+
                             |
                    SSE / REST API
                             |
              +--------------+--------------+
              |         Express Server      |
              +--------------+--------------+
              |                             |
     +--------v--------+          +--------v--------+
     | Socratic Agent  |          | Processing      |
     | (Strands Agent) |          | Orchestrator    |
     +--------+--------+          +--------+--------+
              |                            |
     +--------v--------+     +------------+------------+
     | Tools:          |     |  Parallel Processors    |
     | - analyze_doc   |     +--+--+--+--+-------------+
     | - recommend_cap |        |  |  |  |
     +--------+--------+        v  v  v  v
              |               BDA CL NO TX    (4-5 processors)
              v               Pro    va  t    (BDA = std+custom)
     +--------v--------+
     | Router Agent    |     (each uses StreamAdapter)
     | (capability     |
     |  routing logic) |
     +--------+--------+          +--------v--------+
              |                   | Architect Agent  |
              v                   | (Strands Agent)  |
     Start Processing             +--------+--------+
                                           |
                                  Tools: generate_architecture
```

**Agent Details:**

1. **Socratic Agent** (`socratic-agent.ts`)
   - Model: Claude Sonnet 4 via Bedrock
   - Tools: `analyze_document`, `recommend_capabilities`
   - Pattern: Single agent with tools (simplest Strands pattern)
   - Streaming: `agent.stream()` through `StrandsEventAdapter` for token-by-token delivery

2. **Router Agent** (`router-agent.ts`)
   - Not a Strands agent -- pure TypeScript logic
   - Maps selected capabilities to appropriate methods
   - Determines which processors to activate

3. **Architect Agent** (`architect-agent.ts`)
   - Model: Claude Sonnet 4 via Bedrock
   - Tools: `generate_architecture` (formats mermaid diagrams, cost tables)
   - Takes processing results as context in the prompt
   - Streaming: `agent.stream()` through `StrandsEventAdapter` for recommendation text

---

## Streaming Protocol Design

### SSE Format
```
data: {"type":"text","data":"Based on"}\n\n
data: {"type":"text","data":" your document"}\n\n
data: {"type":"tool_use","data":{"name":"analyze_document","input":{"s3Uri":"s3://..."}}}\n\n
data: {"type":"tool_result","data":{"name":"analyze_document","result":{"pageCount":3,"hasTables":true}}}\n\n
: keepalive\n\n
```

### SSE Keepalive
All SSE endpoints send `: keepalive\n\n` every 15 seconds to prevent proxy/load-balancer timeouts.

### Frontend SSE Hook
```typescript
// packages/frontend/src/hooks/useSSE.ts
export function useSSE<T>(url: string) {
  const [events, setEvents] = useState<T[]>([])
  const [status, setStatus] = useState<'idle' | 'streaming' | 'complete' | 'error'>('idle')
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(async (body: Record<string, unknown>) => {
    // body passed as argument, NOT in useCallback deps (prevents infinite re-renders)
    setStatus('streaming')
    setEvents([])
    abortRef.current = new AbortController()

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      })

      if (!response.ok) {
        setStatus('error')
        return
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) { setStatus('complete'); break }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const event = JSON.parse(line.slice(6))
            setEvents(prev => [...prev, event])
          }
          // Ignore keepalive comments (lines starting with ':')
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setStatus('error')
      }
    }
  }, [url])  // Only url in deps, body passed as argument

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setStatus('idle')
  }, [])

  return { events, status, start, stop }
}
```

**Note on reconnection:** For the demo timeline, the hook does not auto-reconnect on disconnect. Processing connections are typically under 2 minutes. If a connection drops, the user can retry. Auto-reconnect with event replay would require server-side event buffering, which is out of scope for the demo. This is documented as a post-demo enhancement.

---

## Key Dependencies

### Backend (`packages/backend/package.json`)
```json
{
  "dependencies": {
    "@strands-agents/sdk": "^0.6.0",
    "@aws-sdk/client-bedrock-runtime": "^3.943.0",
    "@aws-sdk/client-bedrock-data-automation": "^3.826.0",
    "@aws-sdk/client-bedrock-data-automation-runtime": "^3.826.0",
    "@aws-sdk/client-s3": "^3.826.0",
    "@aws-sdk/client-textract": "^3.826.0",
    "@aws-sdk/client-sts": "^3.817.0",
    "@aws-sdk/s3-request-presigner": "^3.826.0",
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "multer": "^1.4.5-lts.1",
    "zod": "^3.23.0",
    "uuid": "^10.0.0",
    "dotenv": "^16.4.0"
  }
}
```

### Frontend (`packages/frontend/package.json`)
```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "@cloudscape-design/components": "^3.0.1200",
    "@cloudscape-design/chat-components": "^1.0.100",
    "@cloudscape-design/global-styles": "^1.0.46",
    "@cloudscape-design/design-tokens": "^3.0.32"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0",
    "typescript": "^5.5.0"
  }
}
```

**Note:** No Recharts or third-party charting library. All charts use Cloudscape native components (`BarChart`, `MixedLineBarChart`, `PieChart`).

---

## Environment Variables

```env
# AWS Configuration
AWS_REGION=us-west-2
AWS_PROFILE=default

# S3
S3_BUCKET=idp-unified-platform-uploads
S3_OUTPUT_PREFIX=outputs/

# BDA
BDA_PROFILE_ARN=arn:aws:bedrock:us-west-2:ACCOUNT_ID:data-automation-profile/us.data-automation-v1
BDA_PROJECT_ARN=arn:aws:bedrock:us-west-2:ACCOUNT_ID:data-automation-project/PROJECT_ID
# ^ If BDA_PROJECT_ARN is empty, BDA Custom output is skipped (MVP with 4 methods)

# Models
CLAUDE_MODEL_ID=us.anthropic.claude-sonnet-4-20250514-v1:0
NOVA_MODEL_ID=us.amazon.nova-2-pro-preview-20251202-v1:0

# Server
PORT=3001
FRONTEND_URL=http://localhost:5173
```

---

## Non-Goals (Explicitly Out of Scope)

- **Authentication/Authorization**: This is an internal demo tool. No auth layer. If deployed beyond demo, add Cognito/IAM auth as a follow-up.
- **Auto-reconnect with event replay**: SSE connections do not auto-reconnect. User retries on disconnect.
- **Production scaling**: Single-process architecture is intentional for demo. Not designed for concurrent users.
- **Ground-truth accuracy measurement**: Metrics labeled `confidence` are self-reported by each method. True accuracy would require labeled test sets.

---

## Success Criteria Traceability

| Acceptance Criterion | Phase | Key Files |
|---------------------|-------|-----------|
| User can upload PDF | Phase 1 | `upload.ts`, `DocumentUpload.tsx`, `s3.ts` |
| BDA Custom prerequisite checked | Phase 1 | Step 1.0 checklist |
| Strands SDK event types documented | Phase 2 | `StrandsEventAdapter`, SDK spike output |
| Strands Agent asks questions (streaming) | Phase 2 | `socratic-agent.ts`, `conversation.ts`, `ChatPanel.tsx` |
| System recommends capabilities | Phase 2 | `recommend-capabilities.ts`, `CapabilityCards.tsx` |
| StreamAdapters normalize all processing | Phase 3 | `adapters/*.ts` |
| 3+ methods process in parallel | Phase 3 | `process.ts`, all `processors/*.ts` |
| Real-time streaming progress | Phase 3 | `streaming.ts`, `useSSE.ts`, `MethodCard.tsx` |
| SSE keepalive prevents timeouts | Phase 3 | `streaming.ts`, all SSE endpoints |
| Comparison dashboard side-by-side | Phase 4 | `comparison.ts`, `ComparisonTable.tsx`, `MetricsChart.tsx` |
| Cloudscape native charts (no Recharts) | Phase 4 | `MetricsChart.tsx` using `BarChart`/`MixedLineBarChart` |
| Architecture recommendation | Phase 5 | `architect-agent.ts`, `ArchDiagram.tsx` |
| AgentCore containerization | Phase 5 | `Dockerfile`, `agentcore.config.json` |
| Cloudscape + GenAI patterns | All | `@cloudscape-design/chat-components` usage |
| All 5 capabilities functional | Phase 3 | Capability-to-service mapping table above |
| Node.js + Strands TS SDK | All | `@strands-agents/sdk` throughout backend |
| Confidence (not accuracy) in metrics | Phase 3 | `ProcessorResult.metrics.confidence`, `ComparisonResult` |

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| BDA async processing is slow (30-60s) | Start BDA first, show other results while waiting. `SyncPollAdapter` sends heartbeat during polling. |
| Strands SDK v0.6.0 is preview, APIs may be unstable | Pin exact version. SDK spike (Phase 2 Day 4) documents actual event types. `StrandsEventAdapter` wraps all SDK events so changes are isolated to one file. |
| Strands SDK event types are speculative in this plan | Step 2.0 spike resolves this in first 2 hours of Phase 2. No streaming code written until spike completes. |
| 5 parallel Bedrock calls may hit rate limits | Implement retry with exponential backoff in processor base class. Stagger start times by 500ms. |
| Cloudscape chat components are new | Fall back to standard Cloudscape Container + custom chat layout if chat-components API is insufficient. |
| Demo AWS account may not have all models enabled | Check model access in Phase 1 (Step 1.0). Have fallback model IDs. |
| BDA Custom Blueprint may not exist | Phase 1 prerequisite check. MVP works with 4 methods if no blueprint. |
| Nova 2 Pro may not support `document` content type | Verify in Phase 3; fallback to converting PDF pages to images for Nova. |
| SSE connection drops on long processing | Keepalive every 15s. Manual retry for demo. Auto-reconnect is a post-demo enhancement. |
