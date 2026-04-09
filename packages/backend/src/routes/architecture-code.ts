import { Router } from 'express';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Capability, ProcessorResult, ComparisonResult, ProcessingMethod } from '@idp/shared';
import { METHOD_INFO, CAPABILITY_INFO } from '@idp/shared';
import { bedrockClient, config } from '../config/aws.js';

interface CodeGenRequest {
  capabilities: Capability[];
  processingResults: ProcessorResult[];
  comparison?: ComparisonResult | null;
  pipelineMethods?: Record<string, string>; // capability → method
}

/** Actual extraction prompt patterns used by our adapters */
const ADAPTER_PROMPTS: Record<string, string> = {
  'token-stream': `You are a document processing AI. Extract ONLY the requested capabilities from the document.
Return YAML with each capability as a top-level key.
Each capability must have: data, confidence (0-1), format ("html"|"csv"|"json"|"text")`,
  'bda-llm': `You are a document processing expert. Analyze the BDA extraction output below and produce structured results for each requested capability.
Return JSON with each capability as a key. Each value should have: data, confidence (0-1), format.`,
  'two-phase': `You are a document processing expert. Using the Textract OCR output below, produce structured results for each requested capability.
Return JSON with each capability as a key. Each value should have: data, confidence (0-1), format.`,
};

const CAPABILITY_GUIDANCE: Record<string, string> = {
  document_summarization: 'Write a coherent text summary. Output plain text paragraphs.',
  text_extraction: 'Extract all visible text preserving reading order. Output as plain text.',
  table_extraction: 'Extract tables as HTML <table> with proper <thead>/<tbody>/<tr>/<td>.',
  kv_extraction: 'Extract key-value pairs as JSON object {key: value}.',
  image_description: 'Describe images, charts, and diagrams in the document as text.',
  entity_extraction: 'Extract named entities (names, dates, amounts, addresses) as JSON.',
  document_classification: 'Classify the document type (invoice, contract, form, etc.).',
  pii_detection: 'Identify PII (names, SSN, phone numbers, etc.) and their locations.',
  layout_analysis: 'Detect reading order, columns, sections, headers, footers.',
};

function buildCodeGenPrompt(req: CodeGenRequest): string {
  // Build method→capabilities map from comparison or pipeline
  const methodCaps = new Map<string, string[]>();
  if (req.comparison?.capabilityMatrix) {
    for (const cap of req.capabilities) {
      const matrix = req.comparison.capabilityMatrix[cap];
      if (!matrix) continue;
      let bestMethod = '';
      let bestConf = -1;
      for (const [method, data] of Object.entries(matrix)) {
        const conf = (data as { confidence?: number })?.confidence ?? 0;
        if (conf > bestConf) { bestConf = conf; bestMethod = method; }
      }
      if (bestMethod) {
        if (!methodCaps.has(bestMethod)) methodCaps.set(bestMethod, []);
        methodCaps.get(bestMethod)!.push(cap);
      }
    }
  }
  // Fallback to pipeline methods
  if (methodCaps.size === 0 && req.pipelineMethods) {
    for (const [cap, method] of Object.entries(req.pipelineMethods)) {
      if (!methodCaps.has(method)) methodCaps.set(method, []);
      methodCaps.get(method)!.push(cap);
    }
  }
  // Fallback to processing results
  if (methodCaps.size === 0) {
    for (const r of req.processingResults) {
      if (r.status !== 'complete') continue;
      const caps = Object.keys(r.results).filter(c => req.capabilities.includes(c as Capability));
      if (caps.length > 0) methodCaps.set(r.method, caps);
    }
  }

  const methodDetails = Array.from(methodCaps.entries()).map(([method, caps]) => {
    const info = METHOD_INFO[method as ProcessingMethod];
    const family = info?.family ?? 'unknown';
    const adapterType = family === 'bda' ? 'bda-sync-poll'
      : family === 'bda-llm' ? 'bda-llm'
      : family === 'textract-llm' ? 'two-phase'
      : 'token-stream';
    const capDetails = caps.map(c => {
      const ci = CAPABILITY_INFO[c as keyof typeof CAPABILITY_INFO];
      const guidance = CAPABILITY_GUIDANCE[c] ?? `Extract ${c.replace(/_/g, ' ')} data.`;
      return `  - ${c}: ${ci?.name ?? c} (${guidance})`;
    }).join('\n');

    // Find actual metrics from processing results
    const result = req.processingResults.find(r => r.method === method && r.status === 'complete');
    const metrics = result ? `Actual metrics: ${result.metrics.latencyMs}ms, $${result.metrics.cost.toFixed(4)}, ${result.metrics.tokenUsage ? `${result.metrics.tokenUsage.inputTokens} in / ${result.metrics.tokenUsage.outputTokens} out tokens` : 'N/A'}` : '';

    return `Method: ${method} (${info?.shortName ?? method})
  Family: ${family}
  Model ID: ${info?.modelId ?? 'N/A'}
  Adapter pattern: ${adapterType}
  Adapter prompt pattern: ${ADAPTER_PROMPTS[adapterType] ?? 'Standard extraction prompt'}
  ${metrics}
  Capabilities:
${capDetails}`;
  }).join('\n\n');

  return `Generate production-ready Python (boto3) and TypeScript (AWS SDK v3) code for an IDP pipeline.

METHOD ASSIGNMENTS (from actual benchmark results):
${methodDetails}

ADAPTER PATTERNS (these are the actual patterns that worked in our preview):

1. DIRECT LLM (Claude/Nova via Converse API):
   - Call bedrock.converse() / ConverseCommand with document bytes
   - System prompt: extraction instructions per capability
   - Output: YAML with capability keys, each having data/confidence/format
   - Use maxTokens: 64000, temperature: 0.1

2. BDA (Bedrock Data Automation):
   - Async: InvokeDataAutomationAsync → poll GetDataAutomationStatus → read S3 output
   - Input: S3 URI, output: S3 URI with result.json
   - Parse result.json: pages[].representation.markdown, elements[] by type
   - Profile ARN required

3. BDA + LLM (hybrid):
   - Phase 1: BDA extraction (same as above)
   - Phase 2: Send BDA raw output to LLM for structured extraction
   - Combines BDA's OCR quality with LLM's reasoning

4. TEXTRACT + LLM (two-phase):
   - Phase 1: Textract AnalyzeDocument (sync, <1 page) or StartDocumentAnalysis (async, multi-page)
   - Phase 2: Send OCR text blocks to LLM for structured extraction
   - Poll GetDocumentAnalysis for async

REQUIREMENTS:
- Generate COMPLETE, runnable Python code only (keep it concise but functional)
- Include the ACTUAL extraction prompts per capability (from guidance above)
- Include error handling and retry logic
- Include cost calculation from token usage
- Match the exact model IDs from method info
- Use boto3 for AWS calls
- Keep code under 150 lines total

Return ONLY the code inside <python> tags. No explanations outside the tags.
<python>
...complete Python code...
</python>`;
}

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as CodeGenRequest;

  if (!body.capabilities?.length) {
    res.status(400).json({ error: 'capabilities required' });
    return;
  }

  try {
    const prompt = buildCodeGenPrompt(body);

    const command = new ConverseCommand({
      modelId: config.claudeModelId,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 8192, temperature: 0.1 },
    });

    const response = await bedrockClient.send(command);
    const rawText = response.output?.message?.content?.[0]?.text ?? '';

    const pythonMatch = rawText.match(/<python>([\s\S]*?)<\/python>/);

    res.json({
      python: pythonMatch?.[1]?.trim() ?? rawText.trim(),
      typescript: null,
      cdk: null,
      tokenUsage: response.usage,
    });
  } catch (err) {
    console.error('[Architecture Code Gen Error]', err);
    res.status(500).json({ error: 'Code generation failed' });
  }
});

export default router;
