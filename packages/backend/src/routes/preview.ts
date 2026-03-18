import { Router } from 'express';
import sharp from 'sharp';
import YAML from 'yaml';
import { ConverseCommand, type Message } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, config } from '../config/aws.js';
import { getDocumentBuffer } from '../services/s3.js';
import type { Capability } from '@idp/shared';

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
  'nova-lite': { input: 0.30, output: 2.50 },
  'claude-sonnet': { input: 3.00, output: 15.00 },
};

const PREVIEW_METHODS = [
  { method: 'claude-haiku', modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', shortName: 'Haiku 4.5' },
  { method: 'nova-lite', modelId: 'us.amazon.nova-2-lite-v1:0', shortName: 'Nova 2 Lite' },
  { method: 'claude-sonnet', modelId: 'us.anthropic.claude-sonnet-4-6', shortName: 'Sonnet 4.6' },
];

function calculateCost(method: string, usage: TokenUsage): ActualCost {
  const pricing = TOKEN_PRICING[method] ?? { input: 3.00, output: 15.00 };
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

// Static extraction instructions (cached via CachePoint for 10x cost reduction)
// YAML output saves 10-30% output tokens vs JSON (genaaiidp pattern)
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
  try {
    const s3Uri = body.s3Uri;
    docBuffer = await getDocumentBuffer(s3Uri);
    isPdf = s3Uri.toLowerCase().includes('.pdf');
  } catch (err) {
    console.warn('[Preview] Failed to load document:', err);
  }

  const prompt = buildExtractionPrompt(body.capabilities);

  // Build message content with document
  async function buildMessages(): Promise<Message[]> {
    if (docBuffer && isPdf) {
      return [{
        role: 'user',
        content: [
          { document: { name: 'doc', format: 'pdf', source: { bytes: docBuffer } } },
          { text: prompt },
        ],
      }];
    } else if (docBuffer) {
      const ext = body.s3Uri.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'jpeg';
      const formatMap: Record<string, string> = {
        jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp',
        tiff: 'jpeg', tif: 'jpeg', bmp: 'jpeg',
      };
      const imgFormat = formatMap[ext] ?? 'jpeg';
      const resized = await resizeImageIfNeeded(docBuffer, ext);
      return [{
        role: 'user',
        content: [
          { image: { format: imgFormat as any, source: { bytes: resized } } },
          { text: prompt },
        ],
      }];
    }
    return [{
      role: 'user',
      content: [{ text: `[No document available]\n\n${prompt}` }],
    }];
  }

  const messages = await buildMessages();

  // Run preview with multiple methods in parallel
  const results: MethodPreviewResult[] = await Promise.all(
    PREVIEW_METHODS.map(async (m) => {
      const start = Date.now();
      try {
        const command = new ConverseCommand({
          modelId: m.modelId,
          // CachePoint: static system prompt is cached (10x cheaper for repeated calls)
          system: [
            { text: EXTRACTION_SYSTEM_PROMPT },
            ...(m.method.startsWith('claude') ? [{ cachePoint: { type: 'default' as const } }] : []),
          ],
          messages,
          inferenceConfig: { maxTokens: 4096, temperature: 0.1 },
        });

        const response = await bedrockClient.send(command);
        const latencyMs = Date.now() - start;

        const rawText = response.output?.message?.content?.[0]?.text ?? '';

        // Capture token usage from Bedrock response (includes cache metrics)
        const cacheRead = (response.usage as any)?.cacheReadInputTokenCount ?? 0;
        const cacheWrite = (response.usage as any)?.cacheWriteInputTokenCount ?? 0;
        const tokenUsage: TokenUsage = {
          inputTokens: response.usage?.inputTokens ?? 0,
          outputTokens: response.usage?.outputTokens ?? 0,
          totalTokens: (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0),
        };
        const actualCost = calculateCost(m.method, tokenUsage);

        // Try to parse YAML first (cheaper output), then JSON fallback
        let results: Record<string, unknown> = {};
        try {
          // Strip code block markers if present
          const clean = rawText.replace(/^```(?:ya?ml|json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
          // Try YAML parse (handles both YAML and JSON since JSON is valid YAML)
          const parsed = YAML.parse(clean);
          if (parsed && typeof parsed === 'object') {
            results = parsed;
          } else {
            results = { raw: rawText };
          }
        } catch {
          // Last resort: try JSON extraction
          try {
            const jsonMatch = rawText.match(/(\{[\s\S]*\})/);
            results = jsonMatch ? JSON.parse(jsonMatch[1]) : { raw: rawText };
          } catch {
            results = { raw: rawText };
          }
        }

        return {
          method: m.method,
          modelId: m.modelId,
          shortName: m.shortName,
          results,
          rawText,
          latencyMs,
          tokenUsage,
          actualCost,
        };
      } catch (err) {
        return {
          method: m.method,
          modelId: m.modelId,
          shortName: m.shortName,
          results: {},
          rawText: '',
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }),
  );

  res.json({
    documentId: body.documentId,
    capabilities: body.capabilities,
    methods: PREVIEW_METHODS.map((m) => ({
      method: m.method,
      shortName: m.shortName,
      tokenPricing: TOKEN_PRICING[m.method],
    })),
    results,
  });
});

export default router;
