import type { Response } from 'express';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { bedrockClient, config } from '../config/aws.js';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { CAPABILITY_GUIDANCE, parseResults } from './extraction-shared.js';

/**
 * TwelveLabs Pegasus — purpose-built video understanding.
 *
 * Why this adapter exists separately from `token-stream-adapter`: Pegasus is NOT a
 * Converse model. It is invoked with `InvokeModel` and its own request shape
 * (`inputPrompt` + `mediaSource.s3Location`), and only through a cross-region
 * inference profile (`us.twelvelabs.pegasus-1-2-v1:0`) — the bare model id has no
 * on-demand throughput.
 *
 * That combination is why an earlier probe wrongly concluded Pegasus was unavailable
 * in us-west-2: it tried Converse (wrong API) and the bare id (no throughput), got
 * errors from both, and recorded the model as unusable. The catalog says 30 regions
 * including us-west-2, and a direct InvokeModel probe on a real 9-second mp4 returned
 * all three ground-truth strings WITH timestamps — better than any Converse model
 * managed on the same file. Verify the transport before believing a model is absent.
 *
 * Video must be in S3: there is no inline-bytes source, so a local-only upload
 * cannot be processed.
 */
/**
 * Account id owning the uploads bucket, cached for the process lifetime.
 *
 * Prefers AWS_ACCOUNT_ID when the deployment sets it, and otherwise asks STS — the
 * container does NOT set it, and Pegasus rejects the request outright without a
 * bucketOwner, so depending on the env var alone made the method 100% broken.
 */
let cachedAccountId: string | undefined;
async function resolveAccountId(): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  if (process.env.AWS_ACCOUNT_ID) {
    cachedAccountId = process.env.AWS_ACCOUNT_ID;
    return cachedAccountId;
  }
  const sts = new STSClient({ region: config.region });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  if (!identity.Account) {
    throw new Error('Could not resolve the AWS account id, which Pegasus requires as bucketOwner.');
  }
  cachedAccountId = identity.Account;
  return cachedAccountId;
}

export class PegasusAdapter implements StreamAdapter {
  constructor(readonly method: ProcessingMethod = 'twelvelabs-pegasus') {}

  async run(res: Response | null, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();
    const shortName = METHOD_INFO[this.method]?.shortName ?? this.method;

    if (!input.s3Uri || input.s3Uri.startsWith('local://')) {
      throw new Error(
        `${shortName} reads the video from S3 and this document has no S3 location. `
        + 'Re-upload so the file is stored in S3.',
      );
    }

    emitProgress(res, this.method, 'all', 10, 'Analysing video with Pegasus...');

    /*
     * One prompt covering every requested capability, because Pegasus is a
     * single-turn analyser — there is no cheap way to ask it N times. The guidance
     * per capability is the same text the Converse path uses, so the two produce
     * comparable output rather than differing because they were asked differently.
     */
    const asks = input.capabilities
      .map((c) => `- ${c}: ${CAPABILITY_GUIDANCE[c] ?? `Extract ${c.replace(/_/g, ' ')} data.`}`)
      .join('\n');

    const prompt =
      'Analyse this video and produce the following, as YAML with one top-level key per '
      + 'item. Each key must have `data`, `confidence` (0-1) and `format` '
      + '("json"|"text"|"html"|"csv").\n\n'
      + `${asks}\n\n`
      + 'Describe only what is actually visible or audible, and include timestamps (mm:ss) '
      + 'for anything time-located. Return ONLY valid YAML, no markdown fences.'
      + (input.userInstruction ? `\n\nAdditional requirements:\n${input.userInstruction}` : '');

    const command = new InvokeModelCommand({
      modelId: METHOD_INFO[this.method].modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputPrompt: prompt,
        mediaSource: {
          s3Location: {
            uri: input.s3Uri,
            /*
             * bucketOwner is REQUIRED, not optional — verified live: omitting it fails
             * with "$.mediaSource.s3Location: required property 'bucketOwner' not
             * found". It was previously sent only when AWS_ACCOUNT_ID was set, which
             * the container does not set, so every call failed.
             *
             * Resolved from the caller's own identity rather than an env var, so it
             * cannot silently go missing again.
             */
            bucketOwner: await resolveAccountId(),
          },
        },
      }),
    });

    const response = await bedrockClient.send(command);
    const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
      message?: string;
      finishReason?: string;
      stopReason?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };

    const rawOutput = payload.message ?? '';
    emitProgress(res, this.method, 'all', 90, 'Parsing Pegasus output...');

    const results = parseResults(rawOutput, input.capabilities);

    /*
     * Pegasus prices OUTPUT tokens only ($0.0075 per 1K). It does not always return a
     * usage block, so fall back to a character-based estimate rather than reporting
     * the run as free — a missing usage field is not evidence of zero cost.
     * ~4 chars/token is the standard rough ratio.
     */
    const outputTokens = payload.usage?.outputTokens ?? Math.ceil(rawOutput.length / 4);

    return {
      results,
      rawOutput,
      latencyMs: Date.now() - start,
      tokenUsage: {
        inputTokens: payload.usage?.inputTokens ?? 0,
        outputTokens,
        totalTokens: payload.usage?.totalTokens ?? outputTokens,
      },
    };
  }
}
