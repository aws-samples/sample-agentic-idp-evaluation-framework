import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO, TEXTRACT_PAGE_PRICING } from '@idp/shared';
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
import { applyOutputCap, calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';
import { buildInferenceConfig, parseStructuredJsonResults } from './extraction-shared.js';

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
    // Sync Textract rejects payloads > 5MB or multi-page PDFs.
    // Route to async (S3-based) whenever the buffer exceeds the sync cap.
    const isLargePayload = input.documentBuffer.length > 5 * 1024 * 1024;
    const needsAsync = (isPDF && (input.pageCount ?? 1) > 1) || isLargePayload;
    const hasS3 = !!input.s3Uri && !input.s3Uri.startsWith('local://');

    let blocks: Block[];

    /*
     * Textract is used for PLAIN OCR ONLY — DetectDocumentText at $0.0015/page.
     *
     * AnalyzeDocument's analysis features (TABLES $0.015, FORMS $0.05,
     * TABLES+FORMS $0.065/page) are deliberately never requested: they cost up to
     * 43x more per page, and the whole point of this family is a cheap OCR stage
     * feeding a capable LLM that does the structuring. Paying Textract to detect
     * table structure AND paying an LLM to interpret it defeats the reason to pick
     * a hybrid at all.
     *
     * The consequence is honest in the support matrix: textract-llm is rated
     * "good" (not "excellent") for table and key-value extraction, because the LLM
     * receives OCR lines and infers structure from reading order.
     */
    if (needsAsync && hasS3) {
      blocks = await this.runAsyncTextract(res, input.s3Uri);
    } else if (isLargePayload) {
      // Image too large for sync but no S3 object to fall back to.
      throw new Error(
        `Image exceeds Textract sync 5MB limit (${Math.round(input.documentBuffer.length / 1024 / 1024)}MB). Re-upload via S3 or downscale the image.`,
      );
    } else {
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
            /*
             * The text is plain OCR in reading order, with no table or form
             * structure attached — that is the deliberate cost trade-off of this
             * family. Say so, and tell the model to reconstruct the layout, so it
             * treats line order as evidence rather than assuming it has been given
             * pre-detected cells.
             */
            text: `Below is plain OCR text from Amazon Textract, in reading order. `
              + `It contains no table or form structure — column and row boundaries `
              + `must be reconstructed from the line layout and from values that `
              + `belong together (for example a description followed by quantity, `
              + `unit price and amount). Preserve every line item; do not merge or `
              + `drop rows.\n\n${extractedText}\n\n`
              + `Structure this content for the following capabilities: ${input.capabilities.join(', ')}`,
          },
        ],
      },
    ];

    const converseCommand = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: systemPrompt }],
      messages,
      // Routed through buildInferenceConfig: Opus 5/4.8/4.7 and Sonnet 5 reject
      // `temperature`, so textract-<model> combos would 400 with it hardcoded.
      inferenceConfig: buildInferenceConfig(
        this.modelId,
        applyOutputCap(
          calculateMaxTokens(
            input.capabilities.length,
            input.pageCount ?? 1,
            'json',
            input.capabilities.some(isMediaCapability),
            this.modelId,
          ),
          input.maxOutputTokens,
        ),
      ),
    });

    const llmResponse = await bedrockClient.send(converseCommand);

    let fullText = '';
    let tokenCount = 0;
    let tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;
    // Why generation stopped. Discarding this made a response cut off at the token
    // ceiling indistinguishable from a complete one — see AdapterOutput.truncated.
    let stopReason: string | undefined;

    if (llmResponse.stream) {
      for await (const event of llmResponse.stream) {
        if (event.messageStop?.stopReason) {
          stopReason = event.messageStop.stopReason;
        }
        if (event.contentBlockDelta?.delta?.text) {
          const chunk = event.contentBlockDelta.delta.text;
          fullText += chunk;
          tokenCount++;

          const progress = 40 + Math.min(Math.floor((tokenCount / 100) * 55), 55);
          emitProgress(res, this.method, 'all', progress, chunk);
        }
        // Capture real token usage from the stream's final metadata event.
        //
        // This was dropped, so the LLM half of a two-stage method reported no
        // token usage at all and calculateCost fell back to the flat per-page
        // estimate. Every Textract+LLM run therefore reported exactly its
        // estimate ($0.0050 / $0.0060 / $0.0170) no matter how much work it did,
        // and the "Textract $0.0015/pg + tokens" pricing shown in the UI was
        // never actually computed. Verified live: all three Txt+* methods
        // returned suspiciously round numbers identical to estimatedCostPerPage.
        const usage = event.metadata?.usage;
        if (usage) {
          tokenUsage = {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          };
        }
      }
    }

    emitProgress(res, this.method, 'all', 100, 'Complete');

    const results = parseStructuredJsonResults(fullText, input.capabilities, 0.7);

    return {
      results,
      rawOutput: JSON.stringify({ textractBlocks: blocks.length, llmOutput: fullText }),
      truncated: stopReason === 'max_tokens',
      latencyMs: Date.now() - start,
      tokenUsage,
      ocrConfidence: this.meanOcrConfidence(blocks),
      // Always the plain-OCR price: this adapter only ever calls
      // DetectDocumentText (see the comment on the Textract call above).
      perPageFee: TEXTRACT_PAGE_PRICING.detectText,
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

  /**
   * Mean OCR confidence over the recognised lines, as a 0-1 fraction.
   *
   * This is a *measured* signal, unlike the confidence the LLM reports about its
   * own output: Textract returns a per-block `Confidence` (0-100) reflecting how
   * certain the OCR is of each recognised line. We already pay for it on every
   * two-stage run and were discarding it.
   *
   * It bounds what the downstream LLM can possibly get right — if the OCR text is
   * garbled, no amount of structuring recovers the values — so it is worth
   * surfacing next to the model's self-report rather than in place of it.
   */
  private meanOcrConfidence(blocks: Block[]): number | undefined {
    const scores = blocks
      .filter((b) => b.BlockType === 'LINE' && typeof b.Confidence === 'number')
      .map((b) => b.Confidence as number);
    if (scores.length === 0) return undefined;
    return scores.reduce((a, b) => a + b, 0) / scores.length / 100;
  }

}
