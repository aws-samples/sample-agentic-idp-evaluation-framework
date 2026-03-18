# Pipeline Generation Service - Implementation Summary

## Overview

Implemented an intelligent pipeline generation service that automatically creates optimal document processing pipelines based on user requirements. The service analyzes capabilities, document types, and optimization preferences to select the best processing methods and construct a complete execution graph.

## Files Created

### 1. `/packages/backend/src/services/pipeline-generator.ts`

**Core Intelligence Engine** - Generates optimal processing pipelines from requirements.

**Key Features:**
- **Intelligent Method Selection**: Uses the `CAPABILITY_SUPPORT` matrix from `@idp/shared` to map capabilities to best methods
- **4 Optimization Strategies**:
  - `accuracy`: Selects methods with 'excellent' support level
  - `cost`: Picks cheapest methods with 'good' or better support
  - `speed`: Prioritizes fast models (Haiku, Nova Lite)
  - `balanced`: Weighted score (40% accuracy, 30% cost, 30% speed)
- **Method Deduplication**: If multiple capabilities can be handled by the same method, creates one node
- **Hybrid Routing Support**: Adds page-classifier node that routes pages by content type:
  - Table-heavy → textract-llm methods
  - Image-heavy → claude or nova
  - Text-only → cheapest method (nova-lite)
  - Forms → textract-llm
  - Mixed → balanced approach (claude-sonnet)
- **Auto-generates 2 alternatives** with different optimization strategies
- **DAG Layout**: Automatically positions nodes in left-to-right flow

**Pipeline Structure:**
```
Document Input → [Page Classifier] → Capabilities → Methods → Aggregator → Output
```

**Node Types Generated:**
- `document-input`: Accepts specified document types
- `page-classifier`: Routes by content type (optional)
- `capability`: One per required capability
- `method`: Processing methods (deduplicated)
- `aggregator`: Combines results from all methods
- `output`: Final structured output

### 2. `/packages/backend/src/routes/pipeline.ts`

**REST & SSE Endpoints** - Exposes pipeline generation and execution APIs.

**Endpoints:**

#### `POST /api/pipeline/generate` (JSON Response)
Generates a pipeline definition from user requirements. Fast operation, no AWS calls.

**Request:**
```json
{
  "documentType": "invoice",
  "capabilities": ["text_extraction", "table_extraction", "invoice_processing"],
  "optimizeFor": "balanced",
  "enableHybridRouting": false,
  "preferredMethods": []
}
```

**Response:**
```json
{
  "pipeline": {
    "id": "pipeline-1234567890-1",
    "name": "Balanced-Optimized Pipeline",
    "description": "Pipeline optimized for balanced with 3 capability(s) using 1 method(s)",
    "nodes": [...],
    "edges": [...],
    "estimatedCostPerPage": 0.004,
    "estimatedLatencyMs": 3000,
    "createdAt": "2026-03-17T..."
  },
  "alternatives": [
    { "id": "...", "name": "Accuracy-Optimized Pipeline", ... },
    { "id": "...", "name": "Cost-Optimized Pipeline", ... }
  ],
  "rationale": "**Pipeline Optimization Strategy: BALANCED**\n\n..."
}
```

#### `POST /api/pipeline/execute` (SSE Stream)
Executes a pipeline definition, streaming progress events.

**Request:**
```json
{
  "pipelineId": "pipeline-123",
  "documentId": "doc-456",
  "s3Uri": "s3://bucket/key.pdf",
  "pipeline": { /* PipelineDefinition from /generate */ }
}
```

**SSE Events:**
- `pipeline_start`: Pipeline execution begins
- `node_start`: Processing node starts
- `node_progress`: Progress update (if applicable)
- `node_complete`: Node finished with results and metrics
- `node_error`: Node failed
- `edge_active`: Edge being traversed
- `pipeline_complete`: All nodes finished
- `pipeline_error`: Fatal error

**Features:**
- Reuses existing processors from `/processors` directory
- Runs method nodes in sequence (could be parallelized in future)
- 15-second keepalive for long operations
- Aggregates results from all method nodes

### 3. `/packages/backend/src/index.ts` (Modified)

Added pipeline router to Express app:
```typescript
import pipelineRouter from './routes/pipeline.js';
app.use('/api/pipeline', pipelineRouter);
```

## How It Works

### Method Selection Algorithm

```typescript
function selectMethod(capability, optimizeFor, preferredMethods) {
  // 1. Get candidate methods from CAPABILITY_SUPPORT matrix
  const candidates = getBestMethodsForCapability(capability);

  // 2. Filter to preferred methods if specified
  const filtered = preferredMethods?.length
    ? candidates.filter(m => preferredMethods.includes(m))
    : candidates;

  // 3. Sort/select based on optimization strategy
  switch (optimizeFor) {
    case 'accuracy': return filtered[0]; // already sorted by support level
    case 'cost': return cheapest(filtered);
    case 'speed': return fastest(filtered);
    case 'balanced': return bestScore(filtered); // weighted formula
  }
}
```

### Balanced Scoring Formula

```typescript
accuracyScore = supportLevel === 'excellent' ? 100 : 'good' ? 70 : 'limited' ? 40 : 0
costScore = ((maxCost - methodCost) / maxCost) * 100
speedScore = ((11 - speedRank) / 11) * 100

finalScore = accuracyScore * 0.4 + costScore * 0.3 + speedScore * 0.3
```

### Hybrid Routing Logic

When `enableHybridRouting: true`:
1. Adds a `page-classifier` node after document input
2. Classifier analyzes each page's content type
3. Routes pages to optimal method for that type:
   - **Table-heavy**: `textract-claude-sonnet` (best native table detection)
   - **Image-heavy**: `claude-sonnet` (best vision)
   - **Text-only**: `nova-lite` (cheapest)
   - **Forms**: `textract-claude-haiku` (fast form field detection)
   - **Mixed**: `claude-sonnet` (balanced)

## Testing Results

All optimization strategies tested and working:

| Strategy   | Selected Method(s)               | Cost/Page | Use Case                          |
|------------|----------------------------------|-----------|-----------------------------------|
| `accuracy` | bda-standard + claude-sonnet     | $0.0125   | Maximum extraction quality        |
| `cost`     | nova-lite                        | $0.0030   | High-volume batch processing      |
| `speed`    | claude-haiku                     | $0.0040   | Real-time processing              |
| `balanced` | claude-haiku                     | $0.0040   | General-purpose                   |

**Example Output:**
```
Strategy: ACCURACY
  Selected Methods: bda-standard, claude-sonnet
  Cost/Page: $0.0125
  Alternatives: Cost-Optimized ($0.0030), Speed-Optimized ($0.0040)

Strategy: COST
  Selected Methods: nova-lite
  Cost/Page: $0.0030
  Alternatives: Accuracy-Optimized ($0.0125), Speed-Optimized ($0.0040)
```

## Build Verification

```bash
npm run build -w packages/shared  # ✓ Success
npm run build -w packages/backend # ✓ Success
```

Both packages build without errors. All TypeScript types compile correctly.

## API Usage Examples

### Generate Pipeline

```bash
curl -X POST http://localhost:3001/api/pipeline/generate \
  -H "Content-Type: application/json" \
  -d '{
    "documentType": "invoice",
    "capabilities": ["text_extraction", "table_extraction", "invoice_processing"],
    "optimizeFor": "balanced",
    "enableHybridRouting": false
  }'
```

### Execute Pipeline

```bash
curl -X POST http://localhost:3001/api/pipeline/execute \
  -H "Content-Type: application/json" \
  -d '{
    "pipelineId": "pipeline-123",
    "documentId": "doc-456",
    "s3Uri": "s3://my-bucket/invoice.pdf",
    "pipeline": { /* PipelineDefinition from /generate */ }
  }'
```

## Key Design Decisions

1. **Separation of Concerns**: Generation is fast (no AWS), execution is slow (streams progress)
2. **Reuse Existing Processors**: No new processor implementations needed
3. **Type-Safe**: All types defined in `@idp/shared` package
4. **Method Deduplication**: Reduces cost by consolidating compatible capabilities
5. **Alternative Generation**: Always provides 2 alternatives for comparison
6. **Rationale Generation**: Explains why methods were chosen
7. **Recursive Prevention**: `skipAlternatives` flag prevents infinite recursion

## Future Enhancements

- Parallel method execution in `/execute`
- Cost/latency prediction based on historical data
- A/B testing framework for comparing pipeline configurations
- Visual pipeline editor integration
- Pipeline templates for common document types
- Caching of pipeline definitions
- Analytics on pipeline performance

## Files Modified

- `/packages/backend/src/index.ts`: Added pipeline router

## Dependencies

All dependencies already exist in the project:
- Express for routing
- SSE streaming utilities from `services/streaming.js`
- Existing processors from `processors/` directory
- Type definitions from `@idp/shared` package
- CAPABILITY_SUPPORT and METHOD_INFO constants from shared package

## Verification Complete

✓ Service implementation complete
✓ Routes implemented with validation
✓ Wired into Express app
✓ TypeScript builds without errors
✓ All optimization strategies tested
✓ Method selection logic verified
✓ Alternative generation working
✓ No runtime errors
