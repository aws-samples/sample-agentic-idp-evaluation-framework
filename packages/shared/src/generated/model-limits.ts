/**
 * Per-model output-token ceilings, generated from the Bedrock catalog snapshot.
 *
 * DO NOT EDIT — regenerate with `npx tsx scripts/build-model-limits.ts`.
 * Source: packages/shared/data/bedrock-model-catalog.json (lastUpdated 2026-07-25T06:00:32.738723+00:00).
 *
 * Requesting more output tokens than a model allows is a hard ValidationException
 * ("The maximum tokens you requested exceeds the model limit of N"), so a budget
 * must be clamped per model. 100 models carry a known ceiling here;
 * 55 catalog entries do not publish one and fall back to the caller's default.
 */

export const MODEL_MAX_OUTPUT_TOKENS: Readonly<Record<string, number>> = {
  'ai21.jamba-1-5-large-v1:0': 4096,
  'ai21.jamba-1-5-mini-v1:0': 4096,
  'amazon.nova-2-lite-v1:0': 65536,
  'amazon.nova-2-lite-v1:0:256k': 65536,
  'amazon.nova-2-pro-preview-20251202-v1:0': 65535,
  'amazon.nova-2-sonic-v1:0': 65536,
  'amazon.nova-lite-v1:0': 5120,
  'amazon.nova-lite-v1:0:24k': 5120,
  'amazon.nova-lite-v1:0:300k': 5120,
  'amazon.nova-micro-v1:0': 5120,
  'amazon.nova-micro-v1:0:128k': 5120,
  'amazon.nova-micro-v1:0:24k': 5120,
  'amazon.nova-premier-v1:0': 25600,
  'amazon.nova-premier-v1:0:1000k': 25600,
  'amazon.nova-premier-v1:0:20k': 25600,
  'amazon.nova-premier-v1:0:8k': 25600,
  'amazon.nova-premier-v1:0:mm': 25600,
  'amazon.nova-pro-v1:0': 5120,
  'amazon.nova-pro-v1:0:24k': 5120,
  'amazon.nova-pro-v1:0:300k': 5120,
  'anthropic.claude-3-haiku-20240307-v1:0': 4096,
  'anthropic.claude-3-haiku-20240307-v1:0:200k': 4096,
  'anthropic.claude-3-haiku-20240307-v1:0:48k': 4096,
  'anthropic.claude-fable-5': 128000,
  'anthropic.claude-haiku-4-5-20251001-v1:0': 64000,
  'anthropic.claude-opus-4-1-20250805-v1:0': 64000,
  'anthropic.claude-opus-4-5-20251101-v1:0': 64000,
  'anthropic.claude-opus-4-6-v1': 128000,
  'anthropic.claude-opus-4-7': 128000,
  'anthropic.claude-opus-4-8': 128000,
  'anthropic.claude-opus-5': 128000,
  'anthropic.claude-sonnet-4-20250514-v1:0': 65536,
  'anthropic.claude-sonnet-4-20250514-v1:0:200k': 65536,
  'anthropic.claude-sonnet-4-20250514-v1:0:32k': 65536,
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 64000,
  'anthropic.claude-sonnet-4-6': 64000,
  'anthropic.claude-sonnet-5': 128000,
  'cohere.command-r-plus-v1:0': 4096,
  'cohere.command-r-v1:0': 4096,
  'deepseek.r1-v1:0': 8192,
  'deepseek.v3-v1:0': 8192,
  'deepseek.v3.1': 8192,
  'deepseek.v3.2': 8192,
  'google.gemma-3-12b-it': 8192,
  'google.gemma-3-27b-it': 8192,
  'google.gemma-3-4b-it': 8192,
  'meta.llama3-1-70b-instruct-v1:0': 4096,
  'meta.llama3-1-70b-instruct-v1:0:128k': 4096,
  'meta.llama3-1-8b-instruct-v1:0': 4096,
  'meta.llama3-1-8b-instruct-v1:0:128k': 4096,
  'meta.llama3-3-70b-instruct-v1:0': 4096,
  'meta.llama3-3-70b-instruct-v1:0:128k': 4096,
  'meta.llama3-70b-instruct-v1:0': 8192,
  'meta.llama3-8b-instruct-v1:0': 8192,
  'meta.llama4-maverick-17b-instruct-v1:0': 8192,
  'meta.llama4-maverick-17b-instruct-v1:0:128k': 8192,
  'meta.llama4-maverick-17b-instruct-v1:0:1m': 8192,
  'meta.llama4-scout-17b-instruct-v1:0': 8192,
  'meta.llama4-scout-17b-instruct-v1:0:10m': 8192,
  'meta.llama4-scout-17b-instruct-v1:0:128k': 8192,
  'minimax.minimax-m2': 8192,
  'minimax.minimax-m2.1': 8192,
  'minimax.minimax-m2.5': 8192,
  'mistral.devstral-2-123b': 32768,
  'mistral.magistral-small-2509': 40960,
  'mistral.ministral-3-14b-instruct': 8192,
  'mistral.ministral-3-3b-instruct': 8192,
  'mistral.ministral-3-8b-instruct': 8192,
  'mistral.mistral-7b-instruct-v0:2': 4096,
  'mistral.mistral-large-2402-v1:0': 4096,
  'mistral.mistral-large-2407-v1:0': 4096,
  'mistral.mistral-large-3-675b-instruct': 32768,
  'mistral.mistral-small-2402-v1:0': 4096,
  'mistral.mixtral-8x7b-instruct-v0:1': 4096,
  'mistral.pixtral-large-2502-v1:0': 16384,
  'mistral.voxtral-mini-3b-2507': 32768,
  'mistral.voxtral-small-24b-2507': 32768,
  'moonshot.kimi-k2-thinking': 16384,
  'moonshotai.kimi-k2.5': 16384,
  'nvidia.nemotron-nano-12b-v2': 8192,
  'nvidia.nemotron-nano-3-30b': 8192,
  'nvidia.nemotron-nano-9b-v2': 8192,
  'nvidia.nemotron-super-3-120b': 32768,
  'openai.gpt-oss-120b-1:0': 16384,
  'openai.gpt-oss-20b-1:0': 16384,
  'openai.gpt-oss-safeguard-120b': 16384,
  'openai.gpt-oss-safeguard-20b': 16384,
  'qwen.qwen3-235b-a22b-2507-v1:0': 8192,
  'qwen.qwen3-32b-v1:0': 8192,
  'qwen.qwen3-coder-30b-a3b-v1:0': 16384,
  'qwen.qwen3-coder-480b-a35b-v1:0': 16384,
  'qwen.qwen3-coder-next': 16384,
  'qwen.qwen3-next-80b-a3b': 8192,
  'qwen.qwen3-vl-235b-a22b': 8192,
  'writer.palmyra-vision-7b': 4096,
  'writer.palmyra-x4-v1:0': 8192,
  'writer.palmyra-x5-v1:0': 8192,
  'zai.glm-4.7': 4096,
  'zai.glm-4.7-flash': 4096,
  'zai.glm-5': 131072,
};

/**
 * Output ceiling for a model id, or `undefined` when the catalog does not know.
 *
 * Accepts the cross-region inference profile form our METHOD_INFO uses
 * ("us.anthropic.claude-opus-5") as well as the bare catalog id, and tolerates a
 * version suffix (":0"), because the same model is named all three ways across
 * the SDK, the catalog, and our own config.
 */
export function catalogMaxOutputTokens(modelId?: string): number | undefined {
  if (!modelId) return undefined;
  const candidates = [
    modelId,
    modelId.replace(/^us\./, ''),
    modelId.split(':')[0],
    modelId.replace(/^us\./, '').split(':')[0],
  ];
  for (const candidate of candidates) {
    const hit = MODEL_MAX_OUTPUT_TOKENS[candidate];
    if (hit !== undefined) return hit;
  }
  return undefined;
}
