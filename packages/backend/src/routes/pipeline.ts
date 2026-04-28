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
import { BDA_LIMITS, TEXTRACT_LIMITS, isMethodLanguageCompatible } from '@idp/shared';
import { config } from '../config/aws.js';
import type { AdapterInput } from '../adapters/stream-adapter.js';
import { ProcessorBase } from '../processors/processor-base.js';
import {
  BdaStandardProcessor,
  BdaCustomProcessor,
} from '../processors/bda-processor.js';
import { BdaClaudeSonnetProcessor, BdaClaudeHaikuProcessor, BdaNovaLiteProcessor } from '../processors/bda-llm.js';
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
import { BedrockGuardrailsProcessor } from '../processors/guardrails.js';
import { combineUpstreamText } from '../services/pipeline-text-extractor.js';
import { trackRunResults } from '../services/activity-tracker.js';
import { randomUUID } from 'crypto';

const PROCESSOR_MAP: Partial<Record<ProcessingMethod, () => ProcessorBase>> & Record<string, () => ProcessorBase> = {
  'bda-standard': () => new BdaStandardProcessor(),
  'bda-custom': () => new BdaCustomProcessor(),
  'bda-claude-sonnet': () => new BdaClaudeSonnetProcessor(),
  'bda-claude-haiku': () => new BdaClaudeHaikuProcessor(),
  'bda-nova-lite': () => new BdaNovaLiteProcessor(),
  'claude-sonnet': () => new ClaudeSonnetProcessor(),
  'claude-haiku': () => new ClaudeHaikuProcessor(),
  'claude-opus': () => new ClaudeOpusProcessor(),
  'nova-lite': () => new NovaLiteProcessor(),
  'nova-pro': () => new NovaProProcessor(),
  'textract-claude-sonnet': () => new TextractClaudeSonnetProcessor(),
  'textract-claude-haiku': () => new TextractClaudeHaikuProcessor(),
  'textract-nova-lite': () => new TextractNovaLiteProcessor(),
  'textract-nova-pro': () => new TextractNovaProProcessor(),
  'bedrock-guardrails': () => new BedrockGuardrailsProcessor(),
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
  documentLanguages?: string[];
}

router.post('/execute', async (req, res) => {
  const body = req.body as PipelineExecuteRequest;

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    const { pipelineId, documentId, s3Uri, pipeline } = body;
    const runId = randomUUID();
    const userAlias = (req as any).authUser?.alias ?? 'anonymous';

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

    // Extract capabilities from method nodes (capabilities are stored in method node config)
    const capabilities = Array.from(new Set(
      methodNodes.flatMap((node) => (node.config as any).capabilities ?? [])
    ));

    const fileName = s3Uri.split('/').pop() ?? 'document.pdf';
    const input: AdapterInput = {
      documentBuffer,
      s3Uri,
      fileName,
      capabilities,
      pageCount,
    };

    // Filter out methods with missing config or incompatible document formats
    const ext = (fileName.match(/\.(\w+)$/)?.[1] ?? '').toLowerCase();
    const normalizedExt = ext === 'jpg' ? 'jpeg' : ext === 'tif' ? 'tiff' : ext;
    const isBdaCompatible = (BDA_LIMITS.async.supportedFormats as readonly string[]).includes(normalizedExt);
    const isTextractCompatible = (TEXTRACT_LIMITS.analyzeDocument.supportedFormats as readonly string[]).includes(normalizedExt);

    const documentLanguages: string[] = body.documentLanguages ?? [];

    // Guardrails is allowed for non-Textract formats ONLY when it sits inside a
    // sequential composer — in that case the upstream LLM stage provides the
    // text and Textract is skipped.
    const composerNodeForFilter = pipeline.nodes.find((n) => n.type === 'sequential-composer');
    const sequentialStageIds = new Set<string>(
      composerNodeForFilter ? ((composerNodeForFilter.config as any).stages as string[]) : [],
    );

    const validMethodNodes = methodNodes.filter((node) => {
      const method: ProcessingMethod = (node.config as any).method;
      if (method === 'bda-custom' && !config.bdaProjectArn) {
        emitSSE(res, { type: 'node_error', nodeId: node.id, error: 'BDA Custom not configured (BDA_PROJECT_ARN is empty)' } as PipelineExecutionEvent);
        return false;
      }
      if (method.startsWith('bda-') && !config.bdaProfileArn && method !== 'bda-custom') {
        emitSSE(res, { type: 'node_error', nodeId: node.id, error: 'BDA not configured (BDA_PROFILE_ARN is empty)' } as PipelineExecutionEvent);
        return false;
      }
      if (method.startsWith('bda-') && !isBdaCompatible) {
        emitSSE(res, { type: 'node_error', nodeId: node.id, error: `BDA does not support .${ext} files` } as PipelineExecutionEvent);
        return false;
      }
      if (method.startsWith('textract-') && !isTextractCompatible) {
        emitSSE(res, { type: 'node_error', nodeId: node.id, error: `Textract does not support .${ext} files` } as PipelineExecutionEvent);
        return false;
      }
      if (method === 'bedrock-guardrails') {
        if (!config.bedrockGuardrailId) {
          emitSSE(res, { type: 'node_error', nodeId: node.id, error: 'Bedrock Guardrails not configured (BEDROCK_GUARDRAIL_ID is empty)' } as PipelineExecutionEvent);
          return false;
        }
        // Guardrails inside a sequential composer is fed by upstream text —
        // skip the Textract-compat check for that case. Standalone Guardrails
        // requires Textract-compatible input.
        const inSequential = sequentialStageIds.has(node.id);
        if (!inSequential && !isTextractCompatible) {
          emitSSE(res, { type: 'node_error', nodeId: node.id, error: `Guardrails requires Textract-compatible input; .${ext} not supported (run an LLM stage first)` } as PipelineExecutionEvent);
          return false;
        }
      }
      if (documentLanguages.length && !isMethodLanguageCompatible(method, documentLanguages)) {
        emitSSE(res, { type: 'node_error', nodeId: node.id, error: `${method} does not support non-English documents (${documentLanguages.join(', ')})` } as PipelineExecutionEvent);
        return false;
      }
      return true;
    });

    // Track total cost and results
    let totalCost = 0;
    const allResults: Record<string, CapabilityResult> = {};

    // Detect sequential-composer: if present, we execute stages serially,
    // forwarding the text extracted by upstream stages into the downstream
    // Guardrails stage. Otherwise we run every method node in parallel.
    const composerNode = pipeline.nodes.find((n) => n.type === 'sequential-composer');
    const composerStages: string[] = composerNode
      ? ((composerNode.config as any).stages as string[])
      : [];
    const composerStageSet = new Set(composerStages);

    const runMethodNode = async (
      methodNode: typeof validMethodNodes[number],
      overrideInput?: AdapterInput,
    ): Promise<ProcessorResult | undefined> => {
      const methodConfig = methodNode.config as any;
      const method: ProcessingMethod = methodConfig.method;

      emitSSE(res, {
        type: 'node_start',
        nodeId: methodNode.id,
        nodeType: 'method',
      } as PipelineExecutionEvent);

      try {
        const factory = PROCESSOR_MAP[method];
        if (!factory) {
          emitSSE(res, { type: 'node_error', nodeId: methodNode.id, error: `No processor for method: ${method}` } as PipelineExecutionEvent);
          return undefined;
        }
        const processor = factory();
        const result = await processor.process(res, overrideInput ?? input);

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
        }
        emitSSE(res, {
          type: 'node_error',
          nodeId: methodNode.id,
          error: `Method ${method} failed`,
        } as PipelineExecutionEvent);
        return undefined;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        emitSSE(res, {
          type: 'node_error',
          nodeId: methodNode.id,
          error: errorMsg,
        } as PipelineExecutionEvent);
        return undefined;
      }
    };

    let settled: PromiseSettledResult<ProcessorResult | undefined>[] = [];

    if (composerNode && composerStages.length > 0) {
      // Sequential mode:
      //  - Run every non-composer stage first, in parallel within the extract
      //    column (all nodes except the last composer stage).
      //  - Concatenate their extracted text.
      //  - Run the final composer stage (Guardrails) once with precomputedText.
      const finalStageId = composerStages[composerStages.length - 1];
      const extractStageIds = composerStages.slice(0, -1);
      const extractStageNodes = validMethodNodes.filter((n) => extractStageIds.includes(n.id));
      const finalStageNode = validMethodNodes.find((n) => n.id === finalStageId);
      const parallelNodes = validMethodNodes.filter((n) => !composerStageSet.has(n.id));

      emitSSE(res, {
        type: 'node_start',
        nodeId: composerNode.id,
        nodeType: 'sequential-composer',
      } as PipelineExecutionEvent);

      // Run extract stages + unrelated parallel stages concurrently.
      const extractSettled = await Promise.allSettled(
        [...extractStageNodes, ...parallelNodes].map((n) => runMethodNode(n)),
      );
      settled.push(...extractSettled);

      // Combine extracted text from extract-stage results only.
      const extractResults: (ProcessorResult | undefined)[] = extractSettled
        .slice(0, extractStageNodes.length)
        .map((s) => (s.status === 'fulfilled' ? s.value : undefined));
      const combinedText = combineUpstreamText(extractResults);

      // Run the final Guardrails stage with precomputedText.
      if (finalStageNode) {
        const guardrailsInput: AdapterInput = {
          ...input,
          precomputedText: combinedText || undefined,
        };
        const finalSettled = await Promise.allSettled([runMethodNode(finalStageNode, guardrailsInput)]);
        settled.push(...finalSettled);
      }

      emitSSE(res, {
        type: 'node_complete',
        nodeId: composerNode.id,
        result: { stages: composerStages.length, textChars: combinedText.length },
        metrics: { latencyMs: 0, cost: 0 },
      } as PipelineExecutionEvent);
    } else {
      // Parallel mode (default).
      settled = await Promise.allSettled(validMethodNodes.map((n) => runMethodNode(n)));
    }

    // Collect completed ProcessorResults for comparison
    const processorResults: ProcessorResult[] = settled
      .filter((s): s is PromiseFulfilledResult<ProcessorResult> =>
        s.status === 'fulfilled' && s.value != null)
      .map((s) => s.value);

    const comparison = buildComparison(processorResults);

    // Save run results for the "Recent Runs" feature (non-blocking)
    const ext2 = (fileName.match(/\.(\w+)$/)?.[1] ?? '').toLowerCase();
    trackRunResults(userAlias, {
      runId,
      documentId,
      documentName: fileName,
      s3Uri,
      capabilities,
      methods: processorResults.map((r) => r.method),
      results: processorResults,
      comparison,
      source: 'pipeline',
      status: processorResults.length > 0 ? 'complete' : 'error',
      fileSize: documentBuffer.length,
      pageCount,
      fileType: ext2 || undefined,
      documentLanguages: documentLanguages.length > 0 ? documentLanguages : undefined,
      pipelineDefinition: pipeline,
    });

    // Emit pipeline complete with full results + comparison
    const totalLatencyMs = Date.now() - startTime;
    emitSSE(res, {
      type: 'pipeline_complete',
      runId,
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
