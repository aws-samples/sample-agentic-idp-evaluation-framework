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

    console.error(`[BDA] outputUri from status: ${outputUri}`);
    console.error(`[BDA] invocationArn: ${invocationArn}`);
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

      // Try all known BDA metadata formats to find the actual result
      console.error('[BDA fetchOutput] metadata keys:', Object.keys(metadata), 'output_metadata type:', typeof metadata.output_metadata, 'isArray:', Array.isArray(metadata.output_metadata));

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
              console.log(`[BDA] Fetching result from: s3://${outBucket}/${outKey}`);
              const resultResponse = await s3Client.send(
                new GetObjectCommand({ Bucket: outBucket, Key: outKey }),
              );
              return resultResponse.Body!.transformToString();
            } catch (err) {
              console.warn(`[BDA] Failed to fetch ${outputPath}:`, (err as Error).message);
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
            console.warn(`[BDA] Failed to fetch legacy path ${resultKey}:`, (err as Error).message);
          }
        }
      }

      console.warn('[BDA] Could not find result path in metadata, returning metadata itself');
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
          data: rawOutput.substring(0, 2000),
          confidence: 0.5,
          format: 'text',
        };
      }
      return results;
    }

    // BDA result.json format:
    //   pages[].representation.markdown — full page text in markdown
    //   elements[] — individual elements with type, representation, sub_type
    //   element types: TABLE, TEXT, KEY_VALUE, TITLE, HEADER, FOOTER, etc.
    const pages = (parsed.pages ?? []) as Array<{ representation?: { markdown?: string } }>;
    const elements = (parsed.elements ?? []) as Array<{ type?: string; sub_type?: string; representation?: { markdown?: string; html?: string; text?: string } }>;

    // Extract full document text from pages
    const allText = pages.map((p) => p.representation?.markdown ?? '').join('\n\n').trim();

    // Extract tables from elements
    const tableElements = elements.filter((e) => e.type === 'TABLE');
    const tableData = tableElements.map((t) => t.representation?.markdown ?? t.representation?.html ?? '');

    // Extract key-value pairs from elements
    const kvElements = elements.filter((e) => e.type === 'KEY_VALUE');
    const kvData = kvElements.map((kv) => kv.representation?.markdown ?? kv.representation?.text ?? '');

    for (const cap of capabilities) {
      switch (cap) {
        case 'text_extraction':
          results[cap] = {
            capability: cap,
            data: allText || rawOutput.substring(0, 3000),
            confidence: allText ? 0.9 : 0.5,
            format: 'text',
          };
          break;
        case 'table_extraction':
          results[cap] = {
            capability: cap,
            data: tableData.length > 0 ? tableData.join('\n\n') : allText.substring(0, 2000),
            confidence: tableData.length > 0 ? 0.9 : 0.6,
            format: tableData.length > 0 ? 'text' : 'text',
          };
          break;
        case 'kv_extraction':
          results[cap] = {
            capability: cap,
            data: kvData.length > 0 ? kvData.join('\n') : 'No explicit key-value pairs detected',
            confidence: kvData.length > 0 ? 0.9 : 0.4,
            format: 'text',
          };
          break;
        case 'layout_analysis':
          results[cap] = {
            capability: cap,
            data: elements.map((e) => `[${e.type}${e.sub_type ? ':' + e.sub_type : ''}] ${(e.representation?.markdown ?? '').substring(0, 100)}`).join('\n'),
            confidence: 0.9,
            format: 'text',
          };
          break;
        case 'document_summarization':
          results[cap] = {
            capability: cap,
            data: allText.substring(0, 1000),
            confidence: 0.7,
            format: 'text',
          };
          break;
        default:
          results[cap] = {
            capability: cap,
            data: allText.substring(0, 1000) || 'BDA extraction complete (see raw output)',
            confidence: 0.6,
            format: 'text',
          };
          break;
      }
    }

    return results;
  }
}
