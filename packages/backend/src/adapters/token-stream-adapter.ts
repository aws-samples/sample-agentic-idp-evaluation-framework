import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import sharp from 'sharp';
import YAML from 'yaml';
import {
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { bedrockClient } from '../config/aws.js';
import { calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';
import { CAPABILITY_INFO } from '@idp/shared';

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|tiff|tif|bmp)$/i;
const PDF_EXTENSION = /\.pdf$/i;

type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp';

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

function getImageFormat(fileName: string): ImageFormat {
  const ext = fileName.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'jpeg';
  const map: Record<string, ImageFormat> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', tiff: 'jpeg', tif: 'jpeg', bmp: 'jpeg' };
  return map[ext] ?? 'jpeg';
}

function buildSystemPrompt(capabilities: string[], userInstruction?: string): string {
  const formatHints = capabilities.map((c) => {
    const info = CAPABILITY_INFO[c as keyof typeof CAPABILITY_INFO];
    const fmt = info?.defaultFormat ?? 'json';
    return `- ${c}: output as ${fmt}`;
  }).join('\n');

  const instructionBlock = userInstruction
    ? `\n\nUser's specific requirements (from interview):\n${userInstruction}\n\nTailor your extraction to match these requirements (language, style, detail level, etc.).`
    : '';

  return `You are a document processing AI. Extract the following capabilities from the provided document:
${formatHints}
${instructionBlock}

Return your results as YAML (not JSON) with each capability as a key. For each capability, provide:
- data: the extracted content (use the format specified above)
- confidence: a number between 0 and 1 indicating your confidence
- format: one of "html", "csv", "json", "text"

Return ONLY valid YAML. No markdown code blocks, no JSON.`;
}

export class TokenStreamAdapter implements StreamAdapter {
  constructor(public readonly method: ProcessingMethod) {}

  private get modelId(): string {
    return METHOD_INFO[this.method].modelId;
  }

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();

    emitProgress(res, this.method, 'all', 0, 'Sending document to model...');

    const contentBlocks: ContentBlock[] = [];
    const fileName = input.fileName;

    if (IMAGE_EXTENSIONS.test(fileName)) {
      const format = getImageFormat(fileName);
      const resized = await resizeImageIfNeeded(input.documentBuffer, format);
      contentBlocks.push({
        image: { format, source: { bytes: resized } },
      });
    } else if (PDF_EXTENSION.test(fileName)) {
      contentBlocks.push({
        document: { name: 'document', format: 'pdf', source: { bytes: input.documentBuffer } },
      });
    } else {
      // Office/text files: buffer contains extracted text from file-converter
      const text = input.documentBuffer.toString('utf-8');
      contentBlocks.push({ text: `Document content:\n${text}` });
    }

    contentBlocks.push({ text: `Process this document and extract: ${input.capabilities.join(', ')}` });

    const messages: Message[] = [
      { role: 'user', content: contentBlocks },
    ];

    const command = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: buildSystemPrompt(input.capabilities, input.userInstruction) }],
      messages,
      inferenceConfig: {
        maxTokens: calculateMaxTokens(
          input.capabilities.length,
          input.pageCount ?? 1,
          'yaml',
          input.capabilities.some(isMediaCapability),
        ),
        temperature: 0,
      },
    });

    const response = await bedrockClient.send(command);

    let fullText = '';
    let tokenCount = 0;
    let tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

    if (response.stream) {
      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          const chunk = event.contentBlockDelta.delta.text;
          fullText += chunk;
          tokenCount++;

          const progress = Math.min(Math.floor((tokenCount / 100) * 90), 90);
          emitProgress(res, this.method, 'all', progress, chunk);
        }
        if (event.metadata?.usage) {
          const u = event.metadata.usage;
          tokenUsage = {
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            totalTokens: (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
          };
        }
      }
    }

    emitProgress(res, this.method, 'all', 100, 'Complete');

    const results = this.parseResults(fullText, input.capabilities);

    return {
      results,
      rawOutput: fullText,
      latencyMs: Date.now() - start,
      tokenUsage,
    };
  }

  private parseResults(
    rawOutput: string,
    capabilities: string[],
  ): Record<string, { capability: string; data: unknown; confidence: number; format: string }> {
    const results: Record<string, { capability: string; data: unknown; confidence: number; format: string }> = {};

    let parsed: Record<string, unknown> | null = null;

    // Try multiple parsing strategies
    const yamlFenceMatch = rawOutput.match(/```(?:yaml|YAML|yml)?\s*\n([\s\S]*?)\n\s*```/);
    const jsonFenceMatch = rawOutput.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n\s*```/);
    const cleanStrategies = [
      // 1. Try YAML parse first (handles truncated content gracefully)
      { content: rawOutput.trim(), parser: 'yaml' },
      // 2. Extract YAML from code fences
      { content: yamlFenceMatch?.[1]?.trim() ?? '', parser: 'yaml' },
      // 3. Strip YAML code fences
      { content: rawOutput.replace(/^```(?:yaml|YAML|yml)?\s*\n/, '').replace(/\n\s*```\s*$/, '').trim(), parser: 'yaml' },
      // 4. Try JSON parse (fallback for old responses)
      { content: rawOutput.trim(), parser: 'json' },
      // 5. Extract JSON from code fences
      { content: jsonFenceMatch?.[1]?.trim() ?? '', parser: 'json' },
      // 6. Strip JSON code fences
      { content: rawOutput.replace(/^```(?:json|JSON)?\s*\n/, '').replace(/\n\s*```\s*$/, '').trim(), parser: 'json' },
      // 7. Find first JSON object in text
      { content: rawOutput.match(/(\{[\s\S]*\})/)?.[1]?.trim() ?? '', parser: 'json' },
    ];

    for (const { content, parser } of cleanStrategies) {
      if (!content) continue;
      try {
        const candidate = parser === 'yaml' ? YAML.parse(content) : JSON.parse(content);
        if (candidate && typeof candidate === 'object') {
          parsed = candidate;
          break;
        }
      } catch {
        // Try next strategy
      }
    }

    if (!parsed) {
      // All parsing failed — return raw text per capability
      for (const cap of capabilities) {
        results[cap] = {
          capability: cap,
          data: rawOutput.substring(0, 2000),
          confidence: 0.5,
          format: 'text',
        };
      }
      return results;
    }

    for (const cap of capabilities) {
      // Try exact key match, then underscore/space variations
      const capData = (parsed[cap] ?? parsed[cap.replace(/_/g, ' ')] ?? parsed[cap.replace(/_/g, '-')]) as Record<string, unknown> | string | undefined;

      if (capData && typeof capData === 'object' && 'data' in capData) {
        const isSafeNull = capData.data == null && cap === 'content_moderation';
        const defaultFmt = CAPABILITY_INFO[cap as keyof typeof CAPABILITY_INFO]?.defaultFormat ?? 'json';
        results[cap] = {
          capability: cap,
          data: isSafeNull ? { safe: true, flags: [] } : capData.data,
          confidence: (capData.confidence as number) ?? (isSafeNull ? 0.95 : 0.85),
          format: (capData.format as string) ?? defaultFmt,
        };
      } else if (capData != null) {
        // Direct data (no wrapper)
        const format = CAPABILITY_INFO[cap as keyof typeof CAPABILITY_INFO]?.defaultFormat ?? 'json';
        results[cap] = {
          capability: cap,
          data: capData,
          confidence: 0.8,
          format,
        };
      } else {
        // Capability not found in LLM response — likely truncated output.
        // Provide a fallback from the raw text so downstream consumers still get usable data.
        results[cap] = {
          capability: cap,
          data: rawOutput.length > 0 ? `[Extracted from partial response]\n${rawOutput.substring(0, 1500)}` : null,
          confidence: rawOutput.length > 0 ? 0.3 : 0,
          format: 'text',
        };
      }
    }

    return results;
  }
}
