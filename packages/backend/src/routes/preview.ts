import { Router } from 'express';
import sharp from 'sharp';
import YAML from 'yaml';
import { ConverseCommand, type Message } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, config } from '../config/aws.js';
import { getDocumentBuffer } from '../services/s3.js';
import { calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';
import { convertOfficeDocument, isOfficeFormat } from '../services/file-converter.js';
import type { Capability } from '@idp/shared';
import { getBestMethodsForCapability, METHOD_INFO } from '@idp/shared';

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

async function resizeImageIfNeeded(buffer: Buffer, format: string): Promise<Buffer> {
  if (buffer.length <= MAX_IMAGE_BYTES) return buffer;
  const ratio = Math.sqrt(MAX_IMAGE_BYTES / buffer.length);
  const metadata = await sharp(buffer).metadata();
  const newWidth = Math.round((metadata.width ?? 2000) * ratio);
  let img = sharp(buffer).resize({ width: newWidth, withoutEnlargement: true });
  if (format === 'jpeg' || format === 'jpg') img = img.jpeg({ quality: 80 });
  else if (format === 'png') img = img.png({ compressionLevel: 8 });
  else img = img.jpeg({ quality: 80 });
  return img.toBuffer();
}

interface PreviewRequest {
  documentId: string;
  s3Uri: string;
  capabilities: Capability[];
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ActualCost {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

interface MethodPreviewResult {
  method: string;
  modelId: string;
  shortName: string;
  family: string;
  results: Record<string, unknown>;
  rawText: string;
  latencyMs: number;
  tokenUsage?: TokenUsage;
  actualCost?: ActualCost;
  error?: string;
}

// Token pricing per 1M tokens (USD)
const TOKEN_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku': { input: 1.00, output: 5.00 },
  'claude-sonnet': { input: 3.00, output: 15.00 },
  'nova-lite': { input: 0.30, output: 2.50 },
  'nova-pro': { input: 1.25, output: 10.00 },
};

// LLM methods available for preview (model IDs match shared METHOD_INFO)
const LLM_PREVIEW_METHODS: Record<string, { modelId: string; shortName: string; pricingKey: string }> = {
  'claude-haiku': { modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', shortName: 'Haiku 4.5', pricingKey: 'claude-haiku' },
  'claude-sonnet': { modelId: 'us.anthropic.claude-sonnet-4-6', shortName: 'Sonnet 4.6', pricingKey: 'claude-sonnet' },
  'nova-lite': { modelId: 'us.amazon.nova-2-lite-v1:0', shortName: 'Nova 2 Lite', pricingKey: 'nova-lite' },
  'nova-pro': { modelId: 'us.amazon.nova-2-pro-preview-20251202-v1:0', shortName: 'Nova 2 Pro', pricingKey: 'nova-pro' },
};

function calculateCost(pricingKey: string, usage: TokenUsage): ActualCost {
  const pricing = TOKEN_PRICING[pricingKey] ?? { input: 3.00, output: 15.00 };
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

/**
 * Determine which methods to preview based on selected capabilities.
 * Strategy: pick 1 fast+cheap LLM, 1 accurate LLM, and optionally BDA.
 * All capabilities are sent to EACH method — one LLM call handles all caps together.
 */
function selectPreviewMethods(capabilities: Capability[]): Array<{
  method: string;
  modelId: string;
  shortName: string;
  family: string;
  pricingKey: string;
}> {
  const selected: Array<{ method: string; modelId: string; shortName: string; family: string; pricingKey: string }> = [];

  // Check if BDA is the best method for any capability
  const hasBdaCap = capabilities.some((cap) => {
    const best = getBestMethodsForCapability(cap);
    return best.length > 0 && METHOD_INFO[best[0]]?.family === 'bda';
  });

  // Always include: 1 fast LLM (Haiku) + 1 accurate LLM (Sonnet)
  const haiku = LLM_PREVIEW_METHODS['claude-haiku']!;
  selected.push({ method: 'claude-haiku', modelId: haiku.modelId, shortName: haiku.shortName, family: 'claude', pricingKey: haiku.pricingKey });

  const sonnet = LLM_PREVIEW_METHODS['claude-sonnet']!;
  selected.push({ method: 'claude-sonnet', modelId: sonnet.modelId, shortName: sonnet.shortName, family: 'claude', pricingKey: sonnet.pricingKey });

  // Add BDA if it's the best method for at least one capability
  if (hasBdaCap && config.bdaProfileArn) {
    selected.push({
      method: 'bda-standard',
      modelId: 'bda',
      shortName: 'BDA Standard',
      family: 'bda',
      pricingKey: 'bda',
    });
  }

  return selected;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a document extraction engine. Extract structured data from documents.

RULES:
- Return ONLY valid YAML. No markdown, no explanation, no code blocks.
- Extract actual values from the document, not placeholders.
- Set confidence to 0.0-1.0 based on extraction quality.
- If a capability is not found, set found: false with data: null.

Return format (YAML):
document_type: detected type
language: detected language
confidence: 0.0-1.0
extractions:
  capability_name:
    found: true/false
    data: extracted data
    confidence: 0.0-1.0
summary: one-line summary of document`;

function buildExtractionPrompt(capabilities: Capability[]): string {
  const capList = capabilities.map((c) => `- ${c.replace(/_/g, ' ')}`).join('\n');
  return `Extract the following capabilities from this document:\n${capList}`;
}

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as PreviewRequest;

  if (!body.documentId || !body.capabilities?.length) {
    res.status(400).json({ error: 'documentId and capabilities are required' });
    return;
  }

  // Load document
  let docBuffer: Buffer | null = null;
  let isPdf = false;
  let isImage = false;
  let isOffice = false;
  let officeText = '';

  try {
    const s3Uri = body.s3Uri;
    const fileName = s3Uri.split('/').pop() ?? '';
    docBuffer = await getDocumentBuffer(s3Uri);
    isPdf = /\.pdf$/i.test(fileName);
    isImage = /\.(jpg|jpeg|png|gif|webp|tiff|tif|bmp)$/i.test(fileName);
    isOffice = isOfficeFormat(fileName);

    if (isOffice && docBuffer) {
      const converted = await convertOfficeDocument(docBuffer, fileName);
      officeText = converted.text.substring(0, 8000);
    }
  } catch (err) {
    console.warn('[Preview] Failed to load document:', err);
  }

  const prompt = buildExtractionPrompt(body.capabilities);

  // Build message content with document
  async function buildMessages(): Promise<Message[]> {
    if (docBuffer && isPdf) {
      return [{ role: 'user', content: [
        { document: { name: 'doc', format: 'pdf', source: { bytes: docBuffer } } },
        { text: prompt },
      ] }];
    }
    if (docBuffer && isImage) {
      const ext = body.s3Uri.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'jpeg';
      const formatMap: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', tiff: 'jpeg', tif: 'jpeg', bmp: 'jpeg' };
      const resized = await resizeImageIfNeeded(docBuffer, ext);
      return [{ role: 'user', content: [
        { image: { format: (formatMap[ext] ?? 'jpeg') as any, source: { bytes: resized } } },
        { text: prompt },
      ] }];
    }
    if (isOffice && officeText) {
      return [{ role: 'user', content: [
        { text: `Document content:\n${officeText}\n\n${prompt}` },
      ] }];
    }
    return [{ role: 'user', content: [{ text: `[No document available]\n\n${prompt}` }] }];
  }

  const messages = await buildMessages();

  // Select methods based on capabilities
  const previewMethods = selectPreviewMethods(body.capabilities);

  // Run preview with selected methods in parallel
  const results: MethodPreviewResult[] = await Promise.allSettled(
    previewMethods.map(async (m): Promise<MethodPreviewResult> => {
      const start = Date.now();

      // BDA — use InvokeDataAutomationAsync directly (no SSE needed)
      if (m.family === 'bda') {
        try {
          const { InvokeDataAutomationAsyncCommand, GetDataAutomationStatusCommand } = await import('@aws-sdk/client-bedrock-data-automation-runtime');
          const { GetObjectCommand } = await import('@aws-sdk/client-s3');
          const { bdaClient, s3Client } = await import('../config/aws.js');

          const invokeResp = await bdaClient.send(new InvokeDataAutomationAsyncCommand({
            inputConfiguration: { s3Uri: body.s3Uri },
            outputConfiguration: { s3Uri: `s3://${config.s3Bucket}/preview-output/bda/` },
            dataAutomationProfileArn: config.bdaProfileArn,
          }));
          const invocationArn = invokeResp.invocationArn!;

          // Poll for completion (max 3 min)
          let status = 'IN_PROGRESS';
          let outputUri = '';
          for (let i = 0; i < 60 && status === 'IN_PROGRESS'; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            const statusResp = await bdaClient.send(new GetDataAutomationStatusCommand({ invocationArn }));
            status = statusResp.status ?? 'IN_PROGRESS';
            if (status === 'COMPLETED') {
              outputUri = statusResp.outputConfiguration?.s3Uri ?? '';
            }
          }

          if (status !== 'COMPLETED' || !outputUri) {
            throw new Error(`BDA ${status}`);
          }

          // Fetch result from S3
          const outUrl = new URL(outputUri);
          const metaKey = outUrl.pathname.slice(1) + (outUrl.pathname.endsWith('/') ? '' : '/') + 'job_metadata.json';
          let rawText = '';
          try {
            const metaResp = await s3Client.send(new GetObjectCommand({ Bucket: outUrl.hostname, Key: metaKey }));
            const metaBody = await metaResp.Body!.transformToString();
            const metadata = JSON.parse(metaBody);
            const docs = metadata.output_metadata?.documents;
            if (docs?.[0]?.standard_output?.s3_prefix) {
              const resultResp = await s3Client.send(new GetObjectCommand({ Bucket: outUrl.hostname, Key: docs[0].standard_output.s3_prefix }));
              rawText = await resultResp.Body!.transformToString();
            } else {
              rawText = metaBody;
            }
          } catch {
            rawText = '{}';
          }

          let results: Record<string, unknown> = {};
          try { results = JSON.parse(rawText); } catch { results = { raw: rawText }; }

          return {
            method: m.method, modelId: 'bda', shortName: m.shortName, family: m.family,
            results, rawText, latencyMs: Date.now() - start,
            actualCost: { inputCost: 0, outputCost: 0, totalCost: 0.01 },
          };
        } catch (err) {
          return {
            method: m.method, modelId: 'bda', shortName: m.shortName, family: m.family,
            results: {}, rawText: '', latencyMs: Date.now() - start,
            error: err instanceof Error ? err.message : 'BDA error',
          };
        }
      }

      // LLM methods — use ConverseCommand
      try {
        const command = new ConverseCommand({
          modelId: m.modelId,
          system: [
            { text: EXTRACTION_SYSTEM_PROMPT },
            ...(m.family === 'claude' ? [{ cachePoint: { type: 'default' as const } }] : []),
          ],
          messages,
          inferenceConfig: {
            maxTokens: calculateMaxTokens(
              body.capabilities.length, 1, 'yaml',
              body.capabilities.some(isMediaCapability),
            ),
            temperature: 0.1,
          },
        });

        const response = await bedrockClient.send(command);
        const latencyMs = Date.now() - start;
        const rawText = response.output?.message?.content?.[0]?.text ?? '';

        const tokenUsage: TokenUsage = {
          inputTokens: response.usage?.inputTokens ?? 0,
          outputTokens: response.usage?.outputTokens ?? 0,
          totalTokens: (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0),
        };
        const actualCost = calculateCost(m.pricingKey, tokenUsage);

        let results: Record<string, unknown> = {};
        try {
          const clean = rawText.replace(/^```(?:ya?ml|json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
          const parsed = YAML.parse(clean);
          results = parsed && typeof parsed === 'object' ? parsed : { raw: rawText };
        } catch {
          try {
            const jsonMatch = rawText.match(/(\{[\s\S]*\})/);
            results = jsonMatch ? JSON.parse(jsonMatch[1]) : { raw: rawText };
          } catch {
            results = { raw: rawText };
          }
        }

        return {
          method: m.method, modelId: m.modelId, shortName: m.shortName, family: m.family,
          results, rawText, latencyMs, tokenUsage, actualCost,
        };
      } catch (err) {
        return {
          method: m.method, modelId: m.modelId, shortName: m.shortName, family: m.family,
          results: {}, rawText: '', latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }),
  ).then((settled) =>
    settled.map((s) =>
      s.status === 'fulfilled' ? s.value : {
        method: 'unknown', modelId: '', shortName: 'Error', family: '',
        results: {}, rawText: '', latencyMs: 0, error: (s.reason as Error)?.message ?? 'Unknown error',
      },
    ),
  );

  res.json({
    documentId: body.documentId,
    capabilities: body.capabilities,
    methods: previewMethods.map((m) => ({
      method: m.method,
      shortName: m.shortName,
      family: m.family,
      tokenPricing: TOKEN_PRICING[m.pricingKey],
    })),
    results,
  });
});

export default router;
