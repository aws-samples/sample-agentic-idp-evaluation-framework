import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { v4 as uuidv4 } from 'uuid';
import { InvokeDataAutomationAsyncCommand, GetDataAutomationStatusCommand } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { bdaClient, s3Client, config } from '../config/aws.js';

// BDA status values from API: Created | InProgress | Success | ServiceError | ClientError
const TERMINAL_STATUSES = ['Success', 'ServiceError', 'ClientError'];
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 60; // ~5 minutes

export class SyncPollAdapter implements StreamAdapter {
  constructor(public readonly method: ProcessingMethod) {}

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();

    emitProgress(res, this.method, 'all', 0, 'Invoking BDA...');

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

    emitProgress(res, this.method, 'all', 10, 'Processing document...');

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

      const progress = Math.min(10 + Math.floor((attempts / MAX_POLL_ATTEMPTS) * 80), 90);
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

    emitProgress(res, this.method, 'all', 95, 'Fetching results...');

    const rawOutput = await this.fetchOutput(outputUri);

    emitProgress(res, this.method, 'all', 100, 'Complete');

    const results = this.parseResults(rawOutput, input.capabilities);

    return {
      results,
      rawOutput,
      latencyMs: Date.now() - start,
    };
  }

  private async fetchOutput(s3Uri: string): Promise<string> {
    const url = new URL(s3Uri);
    const bucket = url.hostname;
    const key = decodeURIComponent(url.pathname.slice(1));

    // BDA outputs a job_metadata.json with pointers to actual results
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
