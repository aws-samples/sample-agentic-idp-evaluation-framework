import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { InvokeDataAutomationAsyncCommand, GetDataAutomationStatusCommand } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { bdaClient, s3Client, config } from '../config/aws.js';

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 200; // ~10 minutes

export class SyncPollAdapter implements StreamAdapter {
  constructor(public readonly method: ProcessingMethod) {}

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();

    emitProgress(res, this.method, 'all', 0, 'Invoking BDA...');

    const invokeCommand = new InvokeDataAutomationAsyncCommand({
      inputConfiguration: {
        s3Uri: input.s3Uri,
      },
      outputConfiguration: {
        s3Uri: `s3://${config.s3Bucket}/${config.s3OutputPrefix}${this.method}/`,
      },
      dataAutomationProfileArn: config.bdaProfileArn,
      ...(config.bdaProjectArn
        ? {
            dataAutomationConfiguration: {
              dataAutomationProjectArn: config.bdaProjectArn,
            },
          }
        : {}),
    });

    const invokeResponse = await bdaClient.send(invokeCommand);
    const invocationArn = invokeResponse.invocationArn!;

    emitProgress(res, this.method, 'all', 10, 'Processing document...');

    let status = 'IN_PROGRESS';
    let attempts = 0;

    while (status === 'IN_PROGRESS' && attempts < MAX_POLL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      attempts++;

      const statusCommand = new GetDataAutomationStatusCommand({
        invocationArn,
      });
      const statusResponse = await bdaClient.send(statusCommand);
      status = statusResponse.status ?? 'IN_PROGRESS';

      const progress = Math.min(10 + Math.floor((attempts / MAX_POLL_ATTEMPTS) * 80), 90);
      emitProgress(res, this.method, 'all', progress, `BDA processing... (${status})`);

      if (status === 'COMPLETED') {
        emitProgress(res, this.method, 'all', 95, 'Fetching results...');

        const outputUri = statusResponse.outputConfiguration?.s3Uri;
        if (!outputUri) {
          throw new Error('BDA completed but no output URI returned');
        }

        const rawOutput = await this.fetchOutput(outputUri);

        emitProgress(res, this.method, 'all', 100, 'Complete');

        const results = this.parseResults(rawOutput, input.capabilities);

        return {
          results,
          rawOutput,
          latencyMs: Date.now() - start,
        };
      }

      if (status === 'FAILED' || status === 'STOPPED') {
        throw new Error(`BDA invocation ${status}`);
      }
    }

    throw new Error('BDA invocation timed out');
  }

  private async fetchOutput(s3Uri: string): Promise<string> {
    const url = new URL(s3Uri);
    const bucket = url.hostname;
    const key = url.pathname.slice(1);

    // BDA outputs a job_metadata.json with pointers; try fetching the standard output
    const metadataKey = key.endsWith('/') ? `${key}job_metadata.json` : `${key}/job_metadata.json`;

    try {
      const metaResponse = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: metadataKey }),
      );
      const metaBody = await metaResponse.Body!.transformToString();
      const metadata = JSON.parse(metaBody);

      // Fetch the standard output document result
      const segments = metadata.output_metadata?.documents;
      if (segments && segments.length > 0) {
        const docSegment = segments[0];
        const resultKey = docSegment.standard_output?.s3_prefix
          ?? docSegment.s3_prefix;
        if (resultKey) {
          const resultResponse = await s3Client.send(
            new GetObjectCommand({ Bucket: bucket, Key: resultKey }),
          );
          return resultResponse.Body!.transformToString();
        }
      }

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
      parsed = JSON.parse(rawOutput);
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
      const format = cap === 'table_extraction' ? 'html' : 'json';
      results[cap] = {
        capability: cap,
        data: parsed[cap] ?? parsed,
        confidence: 0.85,
        format,
      };
    }

    return results;
  }
}
