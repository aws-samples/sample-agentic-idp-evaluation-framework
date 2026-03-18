import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import sharp from 'sharp';
import {
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { bedrockClient } from '../config/aws.js';
import { calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';

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

function buildSystemPrompt(capabilities: string[]): string {
  return `You are a document processing AI. Extract the following capabilities from the provided document:
${capabilities.map((c) => `- ${c}`).join('\n')}

Return your results as a JSON object with each capability as a key. For each capability, provide:
- "data": the extracted content
- "confidence": a number between 0 and 1 indicating your confidence
- "format": one of "html", "csv", "json", "text"

For table_extraction, use HTML table format.
For kv_extraction, use JSON key-value pairs.
For image_description, provide text descriptions.
For bounding_box, provide JSON with coordinates.
For text_extraction, provide plain text.

Return ONLY valid JSON, no markdown code blocks.`;
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
      system: [{ text: buildSystemPrompt(input.capabilities) }],
      messages,
      inferenceConfig: {
        maxTokens: calculateMaxTokens(
          input.capabilities.length,
          input.pageCount ?? 1,
          'json',
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

    let parsed: Record<string, unknown>;
    try {
      // Strip markdown code fences if present
      const cleaned = rawOutput.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '');
      parsed = JSON.parse(cleaned);
    } catch {
      for (const cap of capabilities) {
        results[cap] = {
          capability: cap,
          data: rawOutput,
          confidence: 0.5,
          format: 'text',
        };
      }
      return results;
    }

    for (const cap of capabilities) {
      const capData = parsed[cap] as Record<string, unknown> | undefined;
      if (capData && typeof capData === 'object' && 'data' in capData) {
        results[cap] = {
          capability: cap,
          data: capData.data,
          confidence: (capData.confidence as number) ?? 0.8,
          format: (capData.format as string) ?? 'json',
        };
      } else {
        results[cap] = {
          capability: cap,
          data: capData ?? rawOutput,
          confidence: 0.7,
          format: 'json',
        };
      }
    }

    return results;
  }
}
