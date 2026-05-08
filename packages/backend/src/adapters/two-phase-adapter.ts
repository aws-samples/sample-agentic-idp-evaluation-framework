import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import {
  DetectDocumentTextCommand,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
  type Block,
} from '@aws-sdk/client-textract';
import {
  ConverseStreamCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { textractClient, bedrockClient } from '../config/aws.js';
import { calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';

export class TwoPhaseAdapter implements StreamAdapter {
  public readonly method: ProcessingMethod;

  constructor(method: ProcessingMethod) {
    this.method = method;
  }

  private get modelId(): string {
    return METHOD_INFO[this.method].modelId;
  }

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();
    const fileName = input.fileName;
    const isSupported = /\.(pdf|jpg|jpeg|png|tiff|tif)$/i.test(fileName);

    if (!isSupported) {
      throw new Error(`Textract does not support ${fileName.split('.').pop()?.toUpperCase()} files. Use a direct LLM method instead.`);
    }

    // Phase 1: Textract extraction
    emitProgress(res, this.method, 'all', 0, 'Running Textract OCR...');

    const isPDF = /\.pdf$/i.test(fileName);
    const isMultiPage = isPDF && ((input.pageCount ?? 1) > 1 || input.documentBuffer.length > 5 * 1024 * 1024);

    let blocks: Block[];

    if (isMultiPage && input.s3Uri && !input.s3Uri.startsWith('local://')) {
      // Async Textract for multi-page PDFs (requires S3 input)
      blocks = await this.runAsyncTextract(res, input.s3Uri);
    } else {
      // Sync Textract OCR — DetectDocumentText is sufficient since the LLM
      // handles key-value/table structuring. ~$0.0015/page vs $0.065/page.
      const textractCommand = new DetectDocumentTextCommand({
        Document: { Bytes: input.documentBuffer },
      });
      const textractResponse = await textractClient.send(textractCommand);
      blocks = textractResponse.Blocks ?? [];
    }

    const extractedText = this.blocksToText(blocks);

    emitProgress(res, this.method, 'all', 40, 'Textract extraction complete. Structuring with LLM...');

    // Phase 2: LLM structuring
    const systemPrompt = `You are a document structuring AI. Given raw OCR output from Amazon Textract, structure it according to the requested capabilities.

Return your results as a JSON object with each capability as a key. For each capability, provide:
- "data": the structured content
- "confidence": a number between 0 and 1
- "format": one of "html", "csv", "json", "text"

Return ONLY valid JSON, no markdown code blocks.`;

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            text: `Here is the OCR output from Textract:\n\n${extractedText}\n\nPlease structure this content for the following capabilities: ${input.capabilities.join(', ')}`,
          },
        ],
      },
    ];

    const converseCommand = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: systemPrompt }],
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

    const llmResponse = await bedrockClient.send(converseCommand);

    let fullText = '';
    let tokenCount = 0;

    if (llmResponse.stream) {
      for await (const event of llmResponse.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          const chunk = event.contentBlockDelta.delta.text;
          fullText += chunk;
          tokenCount++;

          const progress = 40 + Math.min(Math.floor((tokenCount / 100) * 55), 55);
          emitProgress(res, this.method, 'all', progress, chunk);
        }
      }
    }

    emitProgress(res, this.method, 'all', 100, 'Complete');

    const results = this.parseResults(fullText, input.capabilities);

    return {
      results,
      rawOutput: JSON.stringify({ textractBlocks: blocks.length, llmOutput: fullText }),
      latencyMs: Date.now() - start,
    };
  }

  /** Async Textract for multi-page PDFs. Polls until complete. */
  private async runAsyncTextract(res: Response | null, s3Uri: string): Promise<Block[]> {
    const url = new URL(s3Uri);
    const bucket = url.hostname;
    const key = decodeURIComponent(url.pathname.slice(1));

    const startCmd = new StartDocumentTextDetectionCommand({
      DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
    });
    const startResp = await textractClient.send(startCmd);
    const jobId = startResp.JobId;
    if (!jobId) throw new Error('Textract StartDocumentTextDetection returned no JobId');

    emitProgress(res, this.method, 'all', 10, 'Textract async job started, polling...');

    // Poll until complete (max 60 attempts, 3s interval = ~3 min)
    let status = 'IN_PROGRESS';
    let allBlocks: Block[] = [];
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      const getCmd = new GetDocumentTextDetectionCommand({ JobId: jobId });
      const getResp = await textractClient.send(getCmd);
      status = getResp.JobStatus ?? 'FAILED';

      if (status === 'SUCCEEDED') {
        allBlocks = getResp.Blocks ?? [];

        // Paginate through all results if NextToken exists
        let nextToken = getResp.NextToken;
        while (nextToken) {
          const pageResp = await textractClient.send(
            new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken }),
          );
          allBlocks.push(...(pageResp.Blocks ?? []));
          nextToken = pageResp.NextToken;
        }

        emitProgress(res, this.method, 'all', 35, `Textract extracted ${allBlocks.length} blocks`);
        return allBlocks;
      }

      if (status === 'FAILED' || status === 'PARTIAL_SUCCESS') {
        throw new Error(`Textract async job ${status}: ${getResp.StatusMessage ?? 'unknown error'}`);
      }

      const progress = 10 + Math.min(Math.floor((i / 40) * 25), 25);
      emitProgress(res, this.method, 'all', progress, `Textract processing... (${i * 3}s)`);
    }

    throw new Error('Textract async job timed out after 3 minutes');
  }

  private blocksToText(blocks: Block[]): string {
    const lines: string[] = [];
    for (const block of blocks) {
      if (block.BlockType === 'LINE' && block.Text) {
        lines.push(block.Text);
      }
    }
    return lines.join('\n');
  }

  private parseResults(
    rawOutput: string,
    capabilities: string[],
  ): Record<string, { capability: string; data: unknown; confidence: number; format: string }> {
    const results: Record<string, { capability: string; data: unknown; confidence: number; format: string }> = {};

    let parsed: Record<string, unknown>;
    try {
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
        const isSafeNull = capData.data == null && cap === 'content_moderation';
        results[cap] = {
          capability: cap,
          data: isSafeNull ? { safe: true, flags: [] } : capData.data,
          confidence: (capData.confidence as number) ?? (isSafeNull ? 0.95 : 0.8),
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
