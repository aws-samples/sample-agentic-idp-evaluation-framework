import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import { v4 as uuidv4 } from 'uuid';
import { InvokeDataAutomationAsyncCommand, GetDataAutomationStatusCommand } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  ConverseStreamCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { bdaClient, s3Client, bedrockClient, config } from '../config/aws.js';
import { calculateMaxTokens, isMediaCapability } from '../services/token-budget.js';

// BDA status values from API: Created | InProgress | Success | ServiceError | ClientError
const TERMINAL_STATUSES = ['Success', 'ServiceError', 'ClientError'];
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60; // ~5 minutes

export class BdaLlmAdapter implements StreamAdapter {
  constructor(public readonly method: ProcessingMethod) {}

  private get modelId(): string {
    return METHOD_INFO[this.method].modelId;
  }

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();

    // Guard: BDA requires profile ARN
    if (!config.bdaProfileArn) {
      throw new Error('BDA Profile ARN not configured (BDA_PROFILE_ARN is empty)');
    }

    // Phase 1: BDA extraction
    emitProgress(res, this.method, 'all', 0, 'Phase 1: Invoking BDA...');

    // BDA requires a project ARN: custom project if set, otherwise public-default
    const projectArn = config.bdaProjectArn
      || `arn:aws:bedrock:${config.region}:aws:data-automation-project/public-default`;

    const invokeCommand = new InvokeDataAutomationAsyncCommand({
      clientToken: uuidv4(),
      inputConfiguration: {
        s3Uri: input.s3Uri,
      },
      outputConfiguration: {
        s3Uri: `s3://${config.s3Bucket}/${config.s3OutputPrefix}${this.method}/`,
      },
      dataAutomationProfileArn: config.bdaProfileArn,
      dataAutomationConfiguration: {
        dataAutomationProjectArn: projectArn,
        stage: 'LIVE',
      },
    });

    const invokeResponse = await bdaClient.send(invokeCommand);
    const invocationArn = invokeResponse.invocationArn!;

    emitProgress(res, this.method, 'all', 10, 'BDA processing document...');

    // Poll for completion (status: Created → InProgress → Success/ServiceError/ClientError)
    let status = 'InProgress';
    let attempts = 0;
    let outputUri = '';

    while (!TERMINAL_STATUSES.includes(status) && attempts < MAX_POLL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      attempts++;

      const statusResponse = await bdaClient.send(
        new GetDataAutomationStatusCommand({ invocationArn }),
      );
      status = statusResponse.status ?? 'InProgress';

      const progress = Math.min(10 + Math.floor((attempts / MAX_POLL_ATTEMPTS) * 30), 40);
      emitProgress(res, this.method, 'all', progress, `BDA processing... (${status})`);

      if (status === 'Success') {
        outputUri = statusResponse.outputConfiguration?.s3Uri ?? '';
      }

      if (status === 'ServiceError' || status === 'ClientError') {
        const errorType = (statusResponse as any).errorType ?? status;
        const errorMessage = (statusResponse as any).errorMessage ?? 'Unknown BDA error';
        throw new Error(`BDA ${errorType}: ${errorMessage}`);
      }
    }

    if (status !== 'Success') {
      throw new Error(`BDA invocation timed out after ${attempts * POLL_INTERVAL_MS / 1000}s (last status: ${status})`);
    }

    if (!outputUri) {
      throw new Error('BDA completed but no output URI returned');
    }

    emitProgress(res, this.method, 'all', 45, 'Fetching BDA results...');

    const bdaOutput = await this.fetchOutput(outputUri);

    emitProgress(res, this.method, 'all', 50, 'Phase 1 complete. Phase 2: Structuring with LLM...');

    // Phase 2: LLM enrichment
    const systemPrompt = `You are a document structuring AI. Given raw extraction output from Amazon Bedrock Data Automation (BDA), structure it according to the requested capabilities.

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
            text: `Here is the extraction output from BDA:\n\n${bdaOutput}\n\nPlease structure this content for the following capabilities: ${input.capabilities.join(', ')}`,
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

          const progress = 50 + Math.min(Math.floor((tokenCount / 100) * 45), 45);
          emitProgress(res, this.method, 'all', progress, chunk);
        }
      }
    }

    emitProgress(res, this.method, 'all', 100, 'Complete');

    const results = this.parseResults(fullText, input.capabilities);

    return {
      results,
      rawOutput: JSON.stringify({ bdaOutput, llmOutput: fullText }),
      latencyMs: Date.now() - start,
    };
  }

  private async fetchOutput(s3Uri: string): Promise<string> {
    const url = new URL(s3Uri);
    const bucket = url.hostname;
    const key = decodeURIComponent(url.pathname.slice(1));

    // BDA outputUri may point directly to job_metadata.json or to a directory
    const metadataKey = key.endsWith('job_metadata.json')
      ? key
      : key.endsWith('/') ? `${key}job_metadata.json` : `${key}/job_metadata.json`;

    try {
      const metaResponse = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: metadataKey }),
      );
      const metaBody = await metaResponse.Body!.transformToString();
      const metadata = JSON.parse(metaBody);

      // Format 1: output_metadata[].segment_metadata[].standard_output_path (current BDA)
      const assets = Array.isArray(metadata.output_metadata) ? metadata.output_metadata : [];
      for (const asset of assets) {
        const segments = Array.isArray(asset.segment_metadata) ? asset.segment_metadata : [];
        for (const seg of segments) {
          const outputPath = seg.standard_output_path as string | undefined;
          if (outputPath?.startsWith('s3://')) {
            try {
              const outUrl = new URL(outputPath);
              const outBucket = outUrl.hostname;
              const outKey = decodeURIComponent(outUrl.pathname.slice(1));
              const resultResponse = await s3Client.send(
                new GetObjectCommand({ Bucket: outBucket, Key: outKey }),
              );
              return resultResponse.Body!.transformToString();
            } catch (err) {
              console.warn(`[BDA-LLM] Failed to fetch ${outputPath}:`, (err as Error).message);
            }
          }
        }
      }

      // Format 2: output_metadata.documents[].standard_output.s3_prefix (legacy)
      const legacyMeta = metadata.output_metadata as Record<string, unknown> | undefined;
      const legacyDocs = Array.isArray(legacyMeta) ? [] : ((legacyMeta?.documents ?? []) as Array<Record<string, unknown>>);
      for (const doc of legacyDocs) {
        const resultKey = (doc.standard_output as Record<string, string>)?.s3_prefix ?? (doc as Record<string, string>).s3_prefix;
        if (resultKey) {
          try {
            const resultResponse = await s3Client.send(
              new GetObjectCommand({ Bucket: bucket, Key: resultKey }),
            );
            return resultResponse.Body!.transformToString();
          } catch (err) {
            console.warn(`[BDA-LLM] Failed to fetch legacy path ${resultKey}:`, (err as Error).message);
          }
        }
      }

      console.warn('[BDA-LLM] Could not find result path in metadata, returning metadata itself');
      return metaBody;
    } catch {
      // Fallback: try direct output path
      const resultResponse = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return resultResponse.Body!.transformToString();
    }
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
        // For content_moderation, null/empty data means "safe" — treat as valid
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
          confidence: 0.8,
          format: 'json',
        };
      }
    }

    return results;
  }
}
