/**
 * Amazon Bedrock Mantle — SigV4-signed access to the OpenAI Responses API.
 *
 * Frontier OpenAI models (GPT-5.6 sol/terra/luna, GPT-5.5) are NOT in the
 * Bedrock Converse catalog. They are served ONLY through the OpenAI-compatible
 * Responses endpoint at `bedrock-mantle.<region>.api.aws/openai/v1/responses`,
 * which requires AWS SigV4 (service "bedrock") rather than a bearer token.
 *
 * We sign each request with the SAME AWS credential chain the rest of the app
 * already uses for Bedrock/Textract/S3 — no API key, no extra secret. The ECS
 * task role's `bedrock:InvokeModel` permission covers this endpoint.
 *
 * Region is pinned independently of AWS_REGION (Claude/Nova run in us-west-2,
 * but the frontier GPT models resolve in us-east-2).
 */

import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import { bedrockClient } from './aws.js';

// Region where the frontier OpenAI models are served on Bedrock Mantle.
// All GPT-5.6 tiers + GPT-5.5 resolve in us-east-2 (verified live 2026-07).
export const MANTLE_REGION = process.env.MANTLE_REGION ?? 'us-east-2';

const MANTLE_HOST = `bedrock-mantle.${MANTLE_REGION}.api.aws`;
const MANTLE_RESPONSES_PATH = '/openai/v1/responses';

// Reuse the credential provider already resolved by the shared Bedrock client
// so Mantle picks up the exact same role/creds as every other AWS call.
const signer = new SignatureV4({
  service: 'bedrock',
  region: MANTLE_REGION,
  credentials: bedrockClient.config.credentials,
  sha256: Sha256,
});

export interface MantleResponsesResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  raw: unknown;
}

/**
 * Invoke the Bedrock Mantle OpenAI Responses API with a SigV4-signed request.
 * `input` is the OpenAI Responses `input` payload (string or content blocks).
 */
export async function invokeMantleResponses(params: {
  modelId: string;
  input: unknown;
  maxOutputTokens: number;
  instructions?: string;
}): Promise<MantleResponsesResult> {
  const bodyObj: Record<string, unknown> = {
    model: params.modelId,
    input: params.input,
    max_output_tokens: params.maxOutputTokens,
  };
  if (params.instructions) bodyObj.instructions = params.instructions;
  const body = JSON.stringify(bodyObj);

  const request = new HttpRequest({
    method: 'POST',
    protocol: 'https:',
    hostname: MANTLE_HOST,
    path: MANTLE_RESPONSES_PATH,
    headers: {
      host: MANTLE_HOST,
      'content-type': 'application/json',
    },
    body,
  });

  const signed = await signer.sign(request);

  const res = await fetch(`https://${MANTLE_HOST}${MANTLE_RESPONSES_PATH}`, {
    method: 'POST',
    headers: signed.headers as Record<string, string>,
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mantle Responses API error ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as MantleResponsesRaw;
  return {
    text: extractOutputText(data),
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    raw: data,
  };
}

interface MantleResponsesRaw {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Concatenate all `output_text` blocks from Responses API `message` items. */
function extractOutputText(data: MantleResponsesRaw): string {
  if (!Array.isArray(data.output)) return '';
  let text = '';
  for (const item of data.output) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (block.type === 'output_text' && typeof block.text === 'string') {
        text += block.text;
      }
    }
  }
  return text;
}
