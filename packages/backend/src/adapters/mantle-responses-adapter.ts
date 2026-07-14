import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { invokeMantleResponses } from '../config/mantle.js';
import { calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';
import { isOfficeFormat, convertOfficeDocument } from '../services/file-converter.js';
import {
  IMAGE_EXTENSIONS,
  PDF_EXTENSION,
  getImageFormat,
  resizeImageIfNeeded,
  buildSystemPrompt,
  parseResults,
} from './extraction-shared.js';

/**
 * Adapter for OpenAI GPT models served via the Amazon Bedrock Mantle OpenAI
 * Responses API (SigV4-signed — see config/mantle.ts).
 *
 * Unlike Claude/Nova (Bedrock Converse, token-streamed), Mantle is a single
 * request/response call, so we emit coarse progress markers rather than
 * per-token deltas. GPT-5.x reads PDFs and images natively via the Responses
 * `input_file` / `input_image` content blocks, so no pre-OCR step is needed —
 * this gives GPT a fair, native-document comparison against the other methods.
 */

type ResponsesContentBlock =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; filename: string; file_data: string };

const IMAGE_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

export class MantleResponsesAdapter implements StreamAdapter {
  constructor(public readonly method: ProcessingMethod) {}

  private get modelId(): string {
    return METHOD_INFO[this.method].modelId;
  }

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();
    const fileName = input.fileName;

    emitProgress(res, this.method, 'all', 5, 'Sending document to GPT (Bedrock Mantle)...');

    const content: ResponsesContentBlock[] = [
      {
        type: 'input_text',
        text: `Process this document and extract: ${input.capabilities.join(', ')}`,
      },
    ];

    if (IMAGE_EXTENSIONS.test(fileName)) {
      const format = getImageFormat(fileName);
      const resized = await resizeImageIfNeeded(input.documentBuffer, format);
      const mime = IMAGE_MIME[format] ?? 'image/jpeg';
      content.push({
        type: 'input_image',
        image_url: `data:${mime};base64,${resized.toString('base64')}`,
      });
    } else if (PDF_EXTENSION.test(fileName)) {
      content.push({
        type: 'input_file',
        filename: 'document.pdf',
        file_data: `data:application/pdf;base64,${input.documentBuffer.toString('base64')}`,
      });
    } else if (
      isOfficeFormat(fileName) &&
      input.documentBuffer.length > 4 &&
      input.documentBuffer[0] === 0x50 &&
      input.documentBuffer[1] === 0x4b &&
      input.documentBuffer[2] === 0x03 &&
      input.documentBuffer[3] === 0x04
    ) {
      const converted = await convertOfficeDocument(input.documentBuffer, fileName);
      content.push({ type: 'input_text', text: `Document content:\n${converted.text}` });
    } else {
      const text = input.documentBuffer.toString('utf-8');
      content.push({ type: 'input_text', text: `Document content:\n${text}` });
    }

    emitProgress(res, this.method, 'all', 40, 'GPT is analyzing the document...');

    const maxOutputTokens = calculateMaxTokens(
      input.capabilities.length,
      input.pageCount ?? 1,
      'yaml',
      input.capabilities.some(isMediaCapability),
    );

    const result = await invokeMantleResponses({
      modelId: this.modelId,
      input: [{ role: 'user', content }],
      maxOutputTokens,
      instructions: buildSystemPrompt(input.capabilities, input.userInstruction),
    });

    emitProgress(res, this.method, 'all', 90, 'Parsing results...');

    const results = parseResults(result.text, input.capabilities);

    emitProgress(res, this.method, 'all', 100, 'Complete');

    return {
      results,
      rawOutput: result.text,
      latencyMs: Date.now() - start,
      tokenUsage:
        result.inputTokens || result.outputTokens
          ? {
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              totalTokens: result.inputTokens + result.outputTokens,
            }
          : undefined,
    };
  }
}
