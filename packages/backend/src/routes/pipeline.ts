import { Router } from 'express';
import type {
  PipelineGenerateRequest,
  PipelineGenerateResponse,
  PipelineDefinition,
  PipelineExecutionEvent,
  ProcessingMethod,
  ProcessorResult,
  CapabilityResult,
} from '@idp/shared';
import { generatePipeline } from '../services/pipeline-generator.js';
import { buildComparison } from '../services/comparison.js';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';
import { getDocumentBuffer } from '../services/s3.js';
import { calculateCost } from '../services/pricing.js';
import { config } from '../config/aws.js';
import type { AdapterInput } from '../adapters/stream-adapter.js';
import { ProcessorBase } from '../processors/processor-base.js';
import {
  BdaStandardProcessor,
  BdaCustomProcessor,
} from '../processors/bda-processor.js';
import {
  ClaudeSonnetProcessor,
  ClaudeHaikuProcessor,
  ClaudeOpusProcessor,
} from '../processors/claude-direct.js';
import { NovaLiteProcessor, NovaProProcessor } from '../processors/nova-direct.js';
import {
  TextractClaudeSonnetProcessor,
  TextractClaudeHaikuProcessor,
  TextractNovaLiteProcessor,
  TextractNovaProProcessor,
} from '../processors/textract-llm.js';

const PROCESSOR_MAP: Partial<Record<ProcessingMethod, () => ProcessorBase>> & Record<string, () => ProcessorBase> = {
  'bda-standard': () => new BdaStandardProcessor(),
  'bda-custom': () => new BdaCustomProcessor(),
  'claude-sonnet': () => new ClaudeSonnetProcessor(),
  'claude-haiku': () => new ClaudeHaikuProcessor(),
  'claude-opus': () => new ClaudeOpusProcessor(),
  'nova-lite': () => new NovaLiteProcessor(),
  'nova-pro': () => new NovaProProcessor(),
  'textract-claude-sonnet': () => new TextractClaudeSonnetProcessor(),
  'textract-claude-haiku': () => new TextractClaudeHaikuProcessor(),
  'textract-nova-lite': () => new TextractNovaLiteProcessor(),
  'textract-nova-pro': () => new TextractNovaProProcessor(),
};

function estimatePageCount(buffer: Buffer): number {
  const content = buffer.toString('binary');
  const matches = content.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 1;
}

const router = Router();

// ─── POST /api/pipeline/generate ─────────────────────────────────────────────
// Generate a pipeline definition from user requirements (fast, no AWS calls)

router.post('/generate', (req, res) => {
  try {
    const request = req.body as PipelineGenerateRequest;

    // Validate request
    if (!request.documentType || !request.capabilities || request.capabilities.length === 0) {
      res.status(400).json({
        error: 'Invalid request: documentType and capabilities are required',
      });
      return;
    }

    if (!request.optimizeFor) {
      request.optimizeFor = 'balanced';
    }

    if (request.enableHybridRouting === undefined) {
      request.enableHybridRouting = false;
    }

    const response: PipelineGenerateResponse = generatePipeline(request);

    res.json(response);
  } catch (err) {
    console.error('[Pipeline Generation Error]', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Pipeline generation failed',
    });
  }
});

// ─── POST /api/pipeline/execute ──────────────────────────────────────────────
// Execute a pipeline definition with SSE streaming

interface PipelineExecuteRequest {
  pipelineId: string;
  documentId: string;
  s3Uri: string;
  pipeline: PipelineDefinition;
}

router.post('/execute', async (req, res) => {
  const body = req.body as PipelineExecuteRequest;

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    const { pipelineId, documentId, s3Uri, pipeline } = body;

    // Validate request
    if (!pipelineId || !documentId || !s3Uri || !pipeline) {
      emitSSE(res, {
        type: 'pipeline_error',
        error: 'Missing required fields: pipelineId, documentId, s3Uri, pipeline',
      } as PipelineExecutionEvent);
      endSSE(res, keepalive);
      return;
    }

    // Emit pipeline start
    emitSSE(res, {
      type: 'pipeline_start',
      pipelineId,
    } as PipelineExecutionEvent);

    const startTime = Date.now();

    // Load document
    const documentBuffer = await getDocumentBuffer(s3Uri);
    const pageCount = estimatePageCount(documentBuffer);

    // Extract method nodes from pipeline
    const methodNodes = pipeline.nodes.filter((node) => node.type === 'method');

    if (methodNodes.length === 0) {
      emitSSE(res, {
        type: 'pipeline_error',
        error: 'Pipeline has no method nodes',
      } as PipelineExecutionEvent);
      endSSE(res, keepalive);
      return;
    }

    // Extract capabilities from capability nodes
    const capabilityNodes = pipeline.nodes.filter(
      (node) => node.type === 'capability',
    );
    const capabilities = capabilityNodes.map(
      (node) => (node.config as any).capability,
    );

    const fileName = s3Uri.split('/').pop() ?? 'document.pdf';
    const input: AdapterInput = {
      documentBuffer,
      s3Uri,
      fileName,
      capabilities,
      pageCount,
    };

    // Filter out BDA methods with missing ARNs
    const validMethodNodes = methodNodes.filter((node) => {
      const method: ProcessingMethod = (node.config as any).method;
      if (method === 'bda-standard' && !config.bdaProfileArn) {
        emitSSE(res, {
          type: 'node_error',
          nodeId: node.id,
          error: 'BDA Standard not configured (BDA_PROFILE_ARN is empty)',
        } as PipelineExecutionEvent);
        return false;
      }
      if (method === 'bda-custom' && !config.bdaProjectArn) {
        emitSSE(res, {
          type: 'node_error',
          nodeId: node.id,
          error: 'BDA Custom not configured (BDA_PROJECT_ARN is empty)',
        } as PipelineExecutionEvent);
        return false;
      }
      return true;
    });

    // Track total cost and results
    let totalCost = 0;
    const allResults: Record<string, CapabilityResult> = {};

    // Execute method nodes in PARALLEL
    const settled = await Promise.allSettled(
      validMethodNodes.map(async (methodNode) => {
        const methodConfig = methodNode.config as any;
        const method: ProcessingMethod = methodConfig.method;

        // Emit node start
        emitSSE(res, {
          type: 'node_start',
          nodeId: methodNode.id,
          nodeType: 'method',
        } as PipelineExecutionEvent);

        try {
          const factory = PROCESSOR_MAP[method];
          if (!factory) {
            emitSSE(res, { type: 'node_error', nodeId: methodNode.id, error: `No processor for method: ${method}` } as PipelineExecutionEvent);
            return;
          }
          const processor = factory();
          const result = await processor.process(res, input);

          if (result.status === 'complete') {
            Object.assign(allResults, result.results);
            totalCost += result.metrics.cost;

            emitSSE(res, {
              type: 'node_complete',
              nodeId: methodNode.id,
              result: result.results,
              metrics: {
                latencyMs: result.metrics.latencyMs,
                cost: result.metrics.cost,
              },
            } as PipelineExecutionEvent);

            return result;
          } else {
            emitSSE(res, {
              type: 'node_error',
              nodeId: methodNode.id,
              error: `Method ${method} failed`,
            } as PipelineExecutionEvent);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          emitSSE(res, {
            type: 'node_error',
            nodeId: methodNode.id,
            error: errorMsg,
          } as PipelineExecutionEvent);
        }
      }),
    );

    // Collect completed ProcessorResults for comparison
    const processorResults: ProcessorResult[] = settled
      .filter((s): s is PromiseFulfilledResult<ProcessorResult> =>
        s.status === 'fulfilled' && s.value != null)
      .map((s) => s.value);

    const comparison = buildComparison(processorResults);

    // Emit pipeline complete with full results + comparison
    const totalLatencyMs = Date.now() - startTime;
    emitSSE(res, {
      type: 'pipeline_complete',
      results: allResults,
      processorResults,
      comparison,
      totalCost,
      totalLatencyMs,
    } as PipelineExecutionEvent);
  } catch (err) {
    console.error('[Pipeline Execution Error]', err);
    emitSSE(res, {
      type: 'pipeline_error',
      error: err instanceof Error ? err.message : 'Unknown error',
    } as PipelineExecutionEvent);
  } finally {
    endSSE(res, keepalive);
  }
});

export default router;
