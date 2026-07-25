import type { Capability } from './capabilities.js';
import { SKILL_INFO } from '../generated/skills.js';

// ─── Processing Methods (families) ────────────────────────────────────────────

export const METHODS = [
  'bda-standard',
  'bda-custom',
  'bda-claude-sonnet',
  'bda-claude-haiku',
  'bda-nova-lite',
  'claude-sonnet',
  'claude-haiku',
  'claude-opus',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-5',
  'nova-lite',
  'gpt-5-6-sol',
  'gpt-5-6-terra',
  'gpt-5-6-luna',
  'gpt-5-5',
  'textract-claude-sonnet',
  'textract-claude-haiku',
  'textract-nova-lite',
  'nova-embeddings',
  'bedrock-guardrails',
  // Purpose-built video understanding on Bedrock. NOT a Converse model — it is
  // invoked with InvokeModel + an inference profile, which is why an earlier
  // Converse probe wrongly concluded it was unavailable here.
  'twelvelabs-pegasus',
  /*
   * Specialist document-OCR models, self-hosted on SageMaker real-time endpoints.
   *
   * These are the olmOCR-bench leaderboard models benchmarked over 336 real
   * yearbook pages in ~/workspaces/35-hybrid-vision-spatial-reasoning. They are a
   * different shape from everything above: no token pricing (you pay for GPU
   * hours), an InvokeEndpoint transport, and each needs an endpoint deployed
   * before it can run. They report unavailable-with-reason until one exists,
   * exactly like bda-custom.
   */
  'sagemaker-infinity-parser2',
  'sagemaker-baidu-ocr',
  'sagemaker-surya-ocr',
  'sagemaker-chandra-ocr',
  'sagemaker-dots-ocr',
  'sagemaker-qwen3-vl',
] as const;

export type ProcessingMethod = (typeof METHODS)[number];

export const METHOD_FAMILIES = [
  'bda', 'bda-llm', 'claude', 'nova', 'gpt', 'textract-llm', 'embeddings', 'guardrails',
  /** TwelveLabs Pegasus — purpose-built video understanding, via InvokeModel. */
  'video-understanding',
  /** Specialist OCR models on self-hosted SageMaker endpoints (GPU-hour billed). */
  'sagemaker-ocr',
] as const;
export type MethodFamily = (typeof METHOD_FAMILIES)[number];

export interface TokenPricing {
  inputPer1MTokens: number;
  outputPer1MTokens: number;
}

export interface MethodInfo {
  id: ProcessingMethod;
  family: MethodFamily;
  name: string;
  shortName: string;
  description: string;
  modelId: string;
  tokenPricing: TokenPricing;
  /**
   * Indicative cost of one page, used for ranking and for pre-run projections
   * before any token count exists. **Derived** from `tokenPricing` — see
   * `estimateCostPerPage`. Never hand-write this: it was hand-written for all 23
   * methods, and when nine token prices were corrected against the live Bedrock
   * catalog these estimates silently kept the old, wrong inputs (the Nova figures
   * were derived from prices 2x too high). A run's *actual* cost always comes from
   * measured token usage in `calculateCost`.
   */
  estimatedCostPerPage: number;
  strengths: string[];
  limitations: string[];
}

/**
 * Token shape of one typical document page, used to turn per-1M-token prices into
 * a comparable per-page figure.
 *
 * Measured, not invented: live preview runs over the test invoice and a 6-page
 * quotation land in the 1,800-2,600 input / 700-1,100 output range per page once
 * the image blocks are counted, so these are the midpoints. They are deliberately
 * one shared constant — the point of `estimatedCostPerPage` is to compare methods
 * on equal footing, which requires holding the workload fixed and varying only
 * the price.
 */
export const TYPICAL_PAGE_TOKENS = { input: 2_200, output: 900 } as const;

/**
 * Fixed per-page service fees that bill outside the token stream. These are the
 * managed stages: BDA's per-page charge and Textract OCR.
 *
 * Kept in sync with the backend's `PER_PAGE_INFRA_FEE`, which applies the same
 * fees to *measured* runs. `TEXTRACT_OCR_PER_PAGE` duplicates
 * `TEXTRACT_PAGE_PRICING.detectText` rather than importing it, because
 * constants/method-limits imports from this module and the cycle would be worse
 * than the duplication; the value is asserted equal in `textract-ocr-only.test.ts`.
 */
const TEXTRACT_OCR_PER_PAGE = 0.0015;
const BDA_PER_PAGE = 0.01;
const BDA_CUSTOM_PER_PAGE = 0.04;
/** Guardrails sensitive-information policy: $0.10 per 1K text units, ~1 unit/page. */
const GUARDRAILS_PER_PAGE = 0.0001;
/**
 * TwelveLabs Pegasus bills per output token only ($0.0075/1K = $7.50/1M); there is
 * no per-page service fee and no separate input-token charge.
 */
const PEGASUS_PER_PAGE = 0;
/**
 * Self-hosted SageMaker OCR: cost is GPU-HOURS, not tokens.
 *
 * Measured over 336 real pages (BENCHMARKS.md in the hybrid vision + spatial
 * reasoning study): ml.g6e.2xlarge at $2.24/hr yields ~263 img/hr => $0.0085/image,
 * and ml.g7e.4xlarge at $7.09/hr yields ~580 img/hr => $0.0122/image. g6e is ~31%
 * cheaper per image despite being 2.2x slower, because g7e costs 3.2x the hour for
 * only 2.2x the throughput. The default below is the g6e figure — the cheapest
 * option, and the one a cost-conscious deployment would pick. A deployment on
 * different hardware overrides it with SAGEMAKER_OCR_COST_PER_PAGE.
 *
 * Note this is the OCR stage ONLY. In the reference pipeline the downstream LLM
 * stage was 75-80% of true per-image cost, so these numbers are not comparable to
 * a full extract-and-structure method without adding that.
 */
const SAGEMAKER_OCR_PER_PAGE = 0.0085;

const SERVICE_FEE_PER_PAGE: Record<MethodFamily, number> = {
  bda: BDA_PER_PAGE,
  'bda-llm': BDA_PER_PAGE,
  'textract-llm': TEXTRACT_OCR_PER_PAGE,
  guardrails: TEXTRACT_OCR_PER_PAGE + GUARDRAILS_PER_PAGE,
  claude: 0,
  nova: 0,
  gpt: 0,
  embeddings: 0,
  'video-understanding': PEGASUS_PER_PAGE,
  'sagemaker-ocr': SAGEMAKER_OCR_PER_PAGE,
};

/**
 * Cost of one typical page: the managed service fee for the family plus the token
 * cost of a typical page at this model's prices.
 *
 * Rounded to 4 decimals ($0.0001), the smallest amount the UI shows. Anything
 * finer would imply a precision an estimate does not have — but a method that
 * bills anything at all never rounds to exactly zero, because "$0.0000" reads as
 * free. Nova Embeddings ($0.02/M input, no output) is the case: it lands at
 * $0.000044/page, and the app previously displayed it as free for the same reason
 * one decimal place lower.
 */
export function estimateCostPerPage(family: MethodFamily, pricing: TokenPricing): number {
  const tokens =
    (TYPICAL_PAGE_TOKENS.input / 1_000_000) * pricing.inputPer1MTokens
    + (TYPICAL_PAGE_TOKENS.output / 1_000_000) * pricing.outputPer1MTokens;
  const total = SERVICE_FEE_PER_PAGE[family] + tokens;
  const rounded = Math.round(total * 10_000) / 10_000;
  return rounded === 0 && total > 0 ? 0.0001 : rounded;
}

export const METHOD_INFO: Record<ProcessingMethod, MethodInfo> = {
  // ─── BDA ────────────────────────────────────────────────────────────────────
  'bda-standard': {
    id: 'bda-standard',
    family: 'bda',
    name: 'BDA Standard Output',
    shortName: 'BDA Std',
    description: 'Amazon Bedrock Data Automation with standard extraction profile',
    modelId: 'us.data-automation-v1',
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
    estimatedCostPerPage: estimateCostPerPage('bda', { inputPer1MTokens: 0, outputPer1MTokens: 0 }),
    strengths: ['Lowest cost', 'Consistent output format', 'No prompt engineering needed'],
    limitations: ['Fixed extraction schema', 'Limited image analysis', 'No bounding boxes'],
  },
  'bda-custom': {
    id: 'bda-custom',
    family: 'bda',
    name: 'BDA Custom Blueprint',
    shortName: 'BDA Custom',
    description: 'Amazon Bedrock Data Automation with custom-defined extraction blueprint',
    modelId: 'us.data-automation-v1',
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
    // Custom blueprints bill at BDA's custom-output rate, not the standard rate,
    // so this one entry overrides the family fee rather than deriving it.
    estimatedCostPerPage: BDA_CUSTOM_PER_PAGE,
    strengths: ['Custom schema', 'Field-level confidence', 'Explainability info'],
    limitations: ['Requires blueprint setup', 'Higher cost', 'No bounding boxes'],
  },

  // ─── BDA + LLM ──────────────────────────────────────────────────────────────
  'bda-claude-sonnet': {
    id: 'bda-claude-sonnet',
    family: 'bda-llm',
    name: 'BDA + Claude Sonnet',
    shortName: 'BDA+Sonnet 4.6',
    description: 'Amazon Bedrock Data Automation followed by Claude Sonnet 4.6 for enrichment',
    modelId: 'us.anthropic.claude-sonnet-4-6',
    tokenPricing: { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00 },
    estimatedCostPerPage: estimateCostPerPage('bda-llm', { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00 }),
    strengths: ['BDA precision + Claude reasoning', 'Best hybrid accuracy', 'Structured enrichment'],
    limitations: ['Two-phase latency', 'Higher combined cost'],
  },
  'bda-claude-haiku': {
    id: 'bda-claude-haiku',
    family: 'bda-llm',
    name: 'BDA + Claude Haiku',
    shortName: 'BDA+Haiku 4.5',
    description: 'Amazon Bedrock Data Automation followed by Claude Haiku 4.5 for fast enrichment',
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    tokenPricing: { inputPer1MTokens: 1.00, outputPer1MTokens: 5.00 },
    estimatedCostPerPage: estimateCostPerPage('bda-llm', { inputPer1MTokens: 1.00, outputPer1MTokens: 5.00 }),
    strengths: ['BDA precision + fast LLM', 'Cost-effective hybrid', 'Good for simple structuring'],
    limitations: ['Haiku may miss complex patterns', 'Two-phase process'],
  },
  'bda-nova-lite': {
    id: 'bda-nova-lite',
    family: 'bda-llm',
    name: 'BDA + Nova 2 Lite',
    shortName: 'BDA+Nova 2 Lite',
    description: 'Amazon Bedrock Data Automation followed by Nova 2 Lite (GA) for enrichment',
    modelId: 'us.amazon.nova-2-lite-v1:0',
    tokenPricing: { inputPer1MTokens: 0.15, outputPer1MTokens: 1.25 },
    estimatedCostPerPage: estimateCostPerPage('bda-llm', { inputPer1MTokens: 0.15, outputPer1MTokens: 1.25 }),
    strengths: ['BDA precision + Nova speed', 'Lowest cost hybrid', 'GA models only'],
    limitations: ['Lite model for structuring', 'Two-phase process'],
  },

  // ─── Claude ─────────────────────────────────────────────────────────────────
  'claude-sonnet': {
    id: 'claude-sonnet',
    family: 'claude',
    name: 'Claude Sonnet 4.6',
    shortName: 'Sonnet 4.6',
    description: 'Anthropic Claude Sonnet 4.6 via Bedrock - best combination of speed and intelligence',
    modelId: 'us.anthropic.claude-sonnet-4-6',
    tokenPricing: { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00 },
    estimatedCostPerPage: estimateCostPerPage('claude', { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00 }),
    strengths: ['Excellent accuracy', 'Strong table extraction', 'Great reasoning', 'Fast', '1M context window'],
    limitations: ['Higher cost than Nova', 'No native bounding boxes'],
  },
  'claude-haiku': {
    id: 'claude-haiku',
    family: 'claude',
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    description: 'Anthropic Claude Haiku 4.5 - fastest model with near-frontier intelligence',
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    tokenPricing: { inputPer1MTokens: 1.00, outputPer1MTokens: 5.00 },
    estimatedCostPerPage: estimateCostPerPage('claude', { inputPer1MTokens: 1.00, outputPer1MTokens: 5.00 }),
    strengths: ['Fastest Claude', 'Very low cost', 'Good for simple extraction', 'Extended thinking'],
    limitations: ['200k context window', 'Weaker on complex nested tables'],
  },
  'claude-opus': {
    id: 'claude-opus',
    family: 'claude',
    name: 'Claude Opus 4.6',
    shortName: 'Opus 4.6',
    description: 'Anthropic Claude Opus 4.6 - the most intelligent model for complex document analysis',
    modelId: 'us.anthropic.claude-opus-4-6-v1',
    tokenPricing: { inputPer1MTokens: 5.00, outputPer1MTokens: 25.00 },
    estimatedCostPerPage: estimateCostPerPage('claude', { inputPer1MTokens: 5.00, outputPer1MTokens: 25.00 }),
    strengths: ['Highest accuracy', 'Best reasoning', '128k output', 'Complex analysis', 'Contract/legal', '1M context'],
    limitations: ['Higher cost than 4.8', 'Moderate latency'],
  },
  'claude-opus-5': {
    id: 'claude-opus-5',
    family: 'claude',
    name: 'Claude Opus 5',
    shortName: 'Opus 5',
    description: "Anthropic Claude Opus 5 via Bedrock - Anthropic's most intelligent model, with adaptive thinking on by default",
    modelId: 'us.anthropic.claude-opus-5',
    tokenPricing: { inputPer1MTokens: 5.00, outputPer1MTokens: 25.00 },
    estimatedCostPerPage: estimateCostPerPage('claude', { inputPer1MTokens: 5.00, outputPer1MTokens: 25.00 }),
    strengths: ['Highest accuracy', 'Adaptive thinking on by default', '128k output', '1M context', 'Best for complex/legal/financial documents'],
    limitations: ['Highest cost', 'Higher latency when thinking deeply'],
  },
  'claude-opus-4-8': {
    id: 'claude-opus-4-8',
    family: 'claude',
    name: 'Claude Opus 4.8',
    shortName: 'Opus 4.8',
    description: 'Anthropic Claude Opus 4.8 via Bedrock - the most intelligent Claude model, with adaptive reasoning',
    modelId: 'us.anthropic.claude-opus-4-8',
    tokenPricing: { inputPer1MTokens: 5.00, outputPer1MTokens: 25.00 },
    estimatedCostPerPage: estimateCostPerPage('claude', { inputPer1MTokens: 5.00, outputPer1MTokens: 25.00 }),
    strengths: ['Highest accuracy', 'Adaptive reasoning', '128k output', '1M context', 'Best for complex/legal documents'],
    limitations: ['Highest cost', 'Moderate latency'],
  },
  'claude-opus-4-7': {
    id: 'claude-opus-4-7',
    family: 'claude',
    name: 'Claude Opus 4.7',
    shortName: 'Opus 4.7',
    description: 'Anthropic Claude Opus 4.7 via Bedrock - frontier reasoning for complex document analysis',
    modelId: 'us.anthropic.claude-opus-4-7',
    tokenPricing: { inputPer1MTokens: 5.00, outputPer1MTokens: 25.00 },
    estimatedCostPerPage: estimateCostPerPage('claude', { inputPer1MTokens: 5.00, outputPer1MTokens: 25.00 }),
    strengths: ['Very high accuracy', 'Adaptive reasoning', '128k output', '1M context', 'Strong on contracts'],
    limitations: ['High cost', 'Moderate latency'],
  },
  'claude-sonnet-5': {
    id: 'claude-sonnet-5',
    family: 'claude',
    name: 'Claude Sonnet 5',
    shortName: 'Sonnet 5',
    description: 'Anthropic Claude Sonnet 5 via Bedrock - near-Opus intelligence at Sonnet pricing',
    modelId: 'us.anthropic.claude-sonnet-5',
    tokenPricing: { inputPer1MTokens: 2.0, outputPer1MTokens: 10.0 },
    estimatedCostPerPage: estimateCostPerPage('claude', { inputPer1MTokens: 2.0, outputPer1MTokens: 10.0 }),
    strengths: ['Near-Opus accuracy at Sonnet cost', 'Adaptive reasoning', '128k output', '1M context', 'Fast'],
    limitations: ['Higher cost than Haiku/Nova', 'No native bounding boxes'],
  },

  // ─── Nova ───────────────────────────────────────────────────────────────────
  'nova-lite': {
    id: 'nova-lite',
    family: 'nova',
    name: 'Nova 2 Lite',
    shortName: 'Nova 2 Lite',
    description: 'Amazon Nova 2 Lite (GA) - fast, cost-effective multimodal with fixed 230 tokens/image pricing',
    modelId: 'us.amazon.nova-2-lite-v1:0',
    tokenPricing: { inputPer1MTokens: 0.15, outputPer1MTokens: 1.25 },
    estimatedCostPerPage: estimateCostPerPage('nova', { inputPer1MTokens: 0.15, outputPer1MTokens: 1.25 }),
    strengths: ['GA model', 'Fastest Nova', 'Lowest cost', 'Fixed 230 tokens/image (resolution-independent)', 'Reasoning capabilities', 'Good for batch'],
    limitations: ['Smaller model', 'Simpler extraction than Pro'],
  },
  // ─── OpenAI GPT (via Amazon Bedrock Mantle, OpenAI Responses API) ─────────────
  // Frontier OpenAI models are NOT in the Bedrock Converse catalog; they are
  // served via the Bedrock Mantle Responses endpoint
  // (bedrock-mantle.<region>.api.aws/openai/v1) with AWS SigV4 auth. modelId is
  // the Bedrock model id (openai.gpt-5.6-*). Pricing matches OpenAI list rates.
  // These models read PDFs and images natively (input_file / input_image).
  'gpt-5-6-sol': {
    id: 'gpt-5-6-sol',
    family: 'gpt',
    name: 'GPT-5.6 Sol (Flagship)',
    shortName: 'GPT-5.6 Sol',
    description: 'OpenAI GPT-5.6 Sol via Amazon Bedrock - flagship tier with the strongest reasoning',
    modelId: 'openai.gpt-5.6-sol',
    tokenPricing: { inputPer1MTokens: 5.5, outputPer1MTokens: 33.0 },
    estimatedCostPerPage: estimateCostPerPage('gpt', { inputPer1MTokens: 5.5, outputPer1MTokens: 33.0 }),
    strengths: ['Frontier GPT reasoning', 'Native PDF + image understanding', '1M context', '128k output'],
    limitations: ['Highest GPT cost', 'Served from us-east-2 (Mantle)'],
  },
  'gpt-5-6-terra': {
    id: 'gpt-5-6-terra',
    family: 'gpt',
    name: 'GPT-5.6 Terra (Balanced)',
    shortName: 'GPT-5.6 Terra',
    description: 'OpenAI GPT-5.6 Terra via Amazon Bedrock - balanced speed/quality/cost tier',
    modelId: 'openai.gpt-5.6-terra',
    tokenPricing: { inputPer1MTokens: 2.75, outputPer1MTokens: 16.5 },
    estimatedCostPerPage: estimateCostPerPage('gpt', { inputPer1MTokens: 2.75, outputPer1MTokens: 16.5 }),
    strengths: ['Strong GPT reasoning', 'Native PDF + image understanding', 'Balanced cost', '1M context'],
    limitations: ['Served from us-east-2 (Mantle)'],
  },
  'gpt-5-6-luna': {
    id: 'gpt-5-6-luna',
    family: 'gpt',
    name: 'GPT-5.6 Luna (Fast)',
    shortName: 'GPT-5.6 Luna',
    description: 'OpenAI GPT-5.6 Luna via Amazon Bedrock - fastest, most cost-effective GPT-5.6 tier',
    modelId: 'openai.gpt-5.6-luna',
    tokenPricing: { inputPer1MTokens: 1.1, outputPer1MTokens: 6.6 },
    estimatedCostPerPage: estimateCostPerPage('gpt', { inputPer1MTokens: 1.1, outputPer1MTokens: 6.6 }),
    strengths: ['Lowest GPT cost', 'Fast', 'Native PDF + image understanding', '1M context'],
    limitations: ['Smaller/faster tier', 'Served from us-east-2 (Mantle)'],
  },
  'gpt-5-5': {
    id: 'gpt-5-5',
    family: 'gpt',
    name: 'GPT-5.5',
    shortName: 'GPT-5.5',
    description: 'OpenAI GPT-5.5 via Amazon Bedrock - previous frontier generation with reasoning',
    modelId: 'openai.gpt-5.5',
    tokenPricing: { inputPer1MTokens: 5.5, outputPer1MTokens: 33.0 },
    estimatedCostPerPage: estimateCostPerPage('gpt', { inputPer1MTokens: 5.5, outputPer1MTokens: 33.0 }),
    strengths: ['Frontier GPT reasoning', 'Native PDF + image understanding', '1M context', '128k output'],
    limitations: ['Higher cost', 'Served from us-east-2 (Mantle)'],
  },

  // ─── Textract + LLM ────────────────────────────────────────────────────────
  'textract-claude-sonnet': {
    id: 'textract-claude-sonnet',
    family: 'textract-llm',
    name: 'Textract + Claude Sonnet',
    shortName: 'Txt+Sonnet 4.6',
    description: 'Amazon Textract OCR followed by Claude Sonnet 4.6 for structuring',
    modelId: 'us.anthropic.claude-sonnet-4-6',
    tokenPricing: { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00 },
    estimatedCostPerPage: estimateCostPerPage('textract-llm', { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00 }),
    strengths: ['Textract precision + Claude reasoning', 'Great for forms', 'Native table detection'],
    limitations: ['Two-step latency', 'Higher combined cost'],
  },
  'textract-claude-haiku': {
    id: 'textract-claude-haiku',
    family: 'textract-llm',
    name: 'Textract + Claude Haiku',
    shortName: 'Txt+Haiku 4.5',
    description: 'Amazon Textract OCR followed by Claude Haiku 4.5 for fast structuring',
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    tokenPricing: { inputPer1MTokens: 1.00, outputPer1MTokens: 5.00 },
    estimatedCostPerPage: estimateCostPerPage('textract-llm', { inputPer1MTokens: 1.00, outputPer1MTokens: 5.00 }),
    strengths: ['Textract precision + fast LLM', 'Cost-effective hybrid', 'Good for simple forms'],
    limitations: ['Haiku may miss complex patterns', 'Two-step process'],
  },
  'textract-nova-lite': {
    id: 'textract-nova-lite',
    family: 'textract-llm',
    name: 'Textract + Nova 2 Lite',
    shortName: 'Txt+Nova 2 Lite',
    description: 'Amazon Textract OCR followed by Nova 2 Lite (GA) for structuring',
    modelId: 'us.amazon.nova-2-lite-v1:0',
    tokenPricing: { inputPer1MTokens: 0.15, outputPer1MTokens: 1.25 },
    estimatedCostPerPage: estimateCostPerPage('textract-llm', { inputPer1MTokens: 0.15, outputPer1MTokens: 1.25 }),
    strengths: ['Textract precision + Nova speed', 'Lowest cost hybrid', 'GA models only', 'Good for batch'],
    limitations: ['Lite model for structuring', 'Two-step process'],
  },

  // ─── Guardrails ──────────────────────────────────────────────────────────────
  'bedrock-guardrails': {
    id: 'bedrock-guardrails',
    family: 'guardrails',
    name: 'Amazon Bedrock Guardrails',
    shortName: 'Guardrails',
    description:
      'Amazon Bedrock Guardrails ApplyGuardrail runtime API — detects PII, regex matches, and sensitive topics. Runs Textract first to extract text from PDFs/images, then applies the guardrail.',
    modelId: 'bedrock-guardrails-apply',
    // Pricing is per text-unit (1 unit = 1 KB of text). Modeled as per-page.
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
    /*
     * Textract DetectDocumentText ($0.0015/page) + the Guardrails
     * sensitive-information policy ($0.10 per 1K text-units ≈ $0.0001/page).
     *
     * The adapter briefly called AnalyzeDocument with `FeatureTypes: ['FORMS']`
     * ($0.05/page, ~33x more) while this figure still said $0.0016 — so the real
     * spend was 33x what was reported. The call is now plain OCR, which is all
     * Guardrails needs: it evaluates a flat string of text and never reads the
     * KEY_VALUE_SET blocks the FORMS feature exists to produce.
     */
    estimatedCostPerPage: estimateCostPerPage('guardrails', { inputPer1MTokens: 0, outputPer1MTokens: 0 }),
    strengths: [
      'Managed PII detection (SSN, credit cards, phones, emails, names, addresses, etc.)',
      'Policy-driven — one config covers all apps',
      'Deterministic — no LLM tokens consumed',
      'Can also flag content policy, denied topics, word filters',
    ],
    limitations: [
      'Requires a configured Guardrail ID (BEDROCK_GUARDRAIL_ID)',
      'Only PII and content-safety capabilities — not general extraction',
      'Needs Textract first for PDFs/images (handled automatically)',
    ],
  },

  // ─── Embeddings ──────────────────────────────────────────────────────────────
  'nova-embeddings': {
    id: 'nova-embeddings',
    family: 'embeddings',
    name: 'Nova Multimodal Embeddings',
    shortName: 'Nova Embed',
    description: 'Amazon Nova 2 Multimodal Embeddings — state-of-the-art unified embedding model for text, documents, images, video, and audio. Enables crossmodal semantic search and RAG.',
    modelId: 'amazon.nova-2-multimodal-embeddings-v1:0',
    tokenPricing: { inputPer1MTokens: 0.02, outputPer1MTokens: 0.0 },
    estimatedCostPerPage: estimateCostPerPage('embeddings', { inputPer1MTokens: 0.02, outputPer1MTokens: 0.0 }),
    strengths: ['Unified multimodal embeddings', 'Text+image+doc+video+audio', 'Crossmodal search', '4 dimension options (256-3072)', 'Batch inference', 'Segmentation for long content'],
    limitations: ['us-east-1 only', 'Embedding only (no generation)', '8K token context for text'],
  },
  // ─── Video understanding (TwelveLabs Pegasus) ───────────────────────────────
  /*
   * Purpose-built video understanding, and the ONLY model here that is invoked with
   * InvokeModel + a cross-region inference profile rather than Converse.
   *
   * An earlier probe concluded Pegasus was unavailable in us-west-2. That was wrong
   * twice over: it tested the Converse API (which Pegasus does not serve) and the
   * bare model id (which needs on-demand throughput it does not have). Verified
   * working with `us.twelvelabs.pegasus-1-2-v1:0` + InvokeModel on a real 9s mp4 —
   * it returned all three ground-truth strings WITH timestamps, which no Converse
   * model did. Catalog confirms 30 regions including us-west-2.
   */
  'twelvelabs-pegasus': {
    id: 'twelvelabs-pegasus',
    family: 'video-understanding',
    name: 'TwelveLabs Pegasus 1.2',
    shortName: 'Pegasus 1.2',
    description:
      'TwelveLabs Pegasus 1.2 — purpose-built video understanding on Amazon Bedrock. '
      + 'Reads video natively (visual + audio + on-screen text) and answers prompts about '
      + 'it with timestamps. Invoked via InvokeModel with an S3 media source, not Converse.',
    modelId: 'us.twelvelabs.pegasus-1-2-v1:0',
    // Output-token priced only ($0.0075 per 1K output tokens per the catalog).
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 7.5 },
    estimatedCostPerPage: estimateCostPerPage('video-understanding', { inputPer1MTokens: 0, outputPer1MTokens: 7.5 }),
    strengths: [
      'Built for video, not adapted to it',
      'Returns timestamps for each observation',
      'Reads on-screen text, visuals and audio together',
      'Long-form video without frame sampling',
      'Available in 30 regions including us-west-2',
    ],
    limitations: [
      'Video only — cannot read documents or images',
      'Requires the video in S3 (no inline bytes)',
      'InvokeModel transport, so no token streaming',
    ],
  },

  // ─── Specialist OCR on self-hosted SageMaker endpoints ──────────────────────
  /*
   * Document-OCR models from the olmOCR-bench leaderboard, self-hosted on SageMaker
   * real-time endpoints. Every strength/limitation below is MEASURED over 336 real
   * scanned pages (see BENCHMARKS.md in the hybrid vision + spatial reasoning
   * study), not inferred from model cards.
   *
   * These are cost-shaped differently from every other method: you pay for GPU
   * hours, so cost per page is fixed by throughput and instance price rather than by
   * tokens, and an idle endpoint still bills. They report unavailable-with-reason
   * until an endpoint is deployed, exactly like bda-custom.
   *
   * The headline benchmark lesson: aggregate F1 is MISLEADING. surya and chandra
   * score 0.670 by emitting nearly every name (recall 0.96) at low precision (0.51)
   * while completely collapsing dense portrait grids — the real discriminator.
   */
  'sagemaker-infinity-parser2': {
    id: 'sagemaker-infinity-parser2',
    family: 'sagemaker-ocr',
    name: 'Infinity-Parser2 Pro (self-hosted)',
    shortName: 'Infinity-Parser2',
    description:
      'infly/Infinity-Parser2-Pro (35B) on a self-hosted SageMaker endpoint. The only '
      + 'model in this set that correctly splits every dense grid layout — it nailed all '
      + 'five hardest pages (25/52/49/36/22 cells) where the others collapsed them.',
    modelId: 'sagemaker:multi-ocr-infinity-parser2',
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
    estimatedCostPerPage: SAGEMAKER_OCR_PER_PAGE,
    strengths: [
      'Only model that splits every dense grid (5/5 hardest pages)',
      'Highest measured layout fidelity of the OCR set',
      'Complementary to Baidu: recovers exactly the pages Baidu collapses',
      'Runs on your own GPU — no per-token cost',
    ],
    limitations: [
      'Needs a deployed SageMaker endpoint (GPU billed hourly, even idle)',
      '35B model — largest and slowest of the set (~50s/page)',
      'Starves above ~2 concurrent dense-grid requests on one endpoint',
      'Returns raw text blocks; an LLM stage is needed to structure them',
    ],
  },
  'sagemaker-baidu-ocr': {
    id: 'sagemaker-baidu-ocr',
    family: 'sagemaker-ocr',
    name: 'Baidu Unlimited-OCR (self-hosted)',
    shortName: 'Baidu OCR',
    description:
      'baidu/Unlimited-OCR (3B) on a self-hosted SageMaker endpoint. Handles ~70% of '
      + 'pages reliably at the lowest measured cost per image, but collapses the densest '
      + 'portrait grids — which is why the reference pipeline pairs it with a fallback.',
    modelId: 'sagemaker:unlimited-ocr',
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
    estimatedCostPerPage: SAGEMAKER_OCR_PER_PAGE,
    strengths: [
      'Lowest measured cost per image ($0.0085 on ml.g6e.2xlarge)',
      'Handles the most large grids overall (41 pages with 15+ cells)',
      'Small (~6.7GB) — fits one GPU, no tensor parallelism needed',
      'gundam tiling mode is strong on small printed text',
    ],
    limitations: [
      'Needs a deployed SageMaker endpoint (GPU billed hourly, even idle)',
      'Collapses the densest portrait grids — pair with an Infinity fallback',
      'OCR only: returns every text region undifferentiated, no field semantics',
      'Single-GPU throughput is fixed; concurrency does not help',
    ],
  },
  'sagemaker-surya-ocr': {
    id: 'sagemaker-surya-ocr',
    family: 'sagemaker-ocr',
    name: 'Surya OCR 2 (self-hosted)',
    shortName: 'Surya OCR 2',
    description:
      'Surya OCR 2 (0.65B) on a self-hosted SageMaker endpoint. Highest measured recall '
      + 'of the set (0.958) but low precision (0.515), and it collapses dense grids — high '
      + 'aggregate F1 that does not survive contact with hard layouts.',
    modelId: 'sagemaker:multi-ocr-surya-ocr-2',
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
    estimatedCostPerPage: SAGEMAKER_OCR_PER_PAGE,
    strengths: [
      'Highest measured recall (0.958) — rarely misses text',
      'Smallest model (0.65B), so cheapest to host',
      'Good on simple single-column pages',
    ],
    limitations: [
      'Needs a deployed SageMaker endpoint (GPU billed hourly, even idle)',
      'Low precision (0.515) — many false positives',
      'Fails dense grids: 2/53 and 1/49 cells on the hardest pages',
      'High aggregate F1 is a recall artifact, not layout skill',
    ],
  },
  'sagemaker-chandra-ocr': {
    id: 'sagemaker-chandra-ocr',
    family: 'sagemaker-ocr',
    name: 'Chandra OCR 2 (self-hosted)',
    shortName: 'Chandra OCR 2',
    description:
      'Chandra OCR 2 (5.3B) on a self-hosted SageMaker endpoint. Highest measured recall '
      + 'of the set (0.960) at low precision (0.514); like Surya it collapses dense grids.',
    modelId: 'sagemaker:multi-ocr-chandra-ocr-2',
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
    estimatedCostPerPage: SAGEMAKER_OCR_PER_PAGE,
    strengths: [
      'Highest measured recall of the set (0.960)',
      'Strong on continuous prose and single-column text',
      'HTML layout output with region labels',
    ],
    limitations: [
      'Needs a deployed SageMaker endpoint (GPU billed hourly, even idle)',
      'Low precision (0.514) — many false positives',
      'Weakest grid handling measured: only 2 pages with 15+ cells',
      'High aggregate F1 is a recall artifact, not layout skill',
    ],
  },
  'sagemaker-dots-ocr': {
    id: 'sagemaker-dots-ocr',
    family: 'sagemaker-ocr',
    name: 'dots.ocr (self-hosted)',
    shortName: 'dots.ocr',
    description:
      'dots.ocr (3B) on a self-hosted SageMaker endpoint. Best precision of the set '
      + '(0.680) but it falls into a repetition loop on dense grids — 29K+ characters with '
      + 'no EOS — so it did not finish the full benchmark.',
    modelId: 'sagemaker:multi-ocr-dots-mocr',
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
    estimatedCostPerPage: SAGEMAKER_OCR_PER_PAGE,
    strengths: [
      'Best measured precision of the OCR set (0.680)',
      'Best name F1 (0.730) on the pages it completed',
      'Compact 3B model',
    ],
    limitations: [
      'Needs a deployed SageMaker endpoint (GPU billed hourly, even idle)',
      'Falls into a repetition loop on dense grids (29K+ chars, no EOS)',
      'Did not finish 336 pages — its score is easy-page biased (182/336)',
      'Slowest to converge; needs an output cap to avoid runaway generation',
    ],
  },
  'sagemaker-qwen3-vl': {
    id: 'sagemaker-qwen3-vl',
    family: 'sagemaker-ocr',
    name: 'Qwen3-VL 235B (self-hosted)',
    shortName: 'Qwen3-VL',
    description:
      'Qwen3-VL 235B on a self-hosted SageMaker endpoint. A general vision-language '
      + 'model rather than a dedicated OCR model, so it reasons about a page as well as '
      + 'reading it — at the cost of the largest GPU footprint in the set.',
    modelId: 'sagemaker:qwen3-vl',
    tokenPricing: { inputPer1MTokens: 0, outputPer1MTokens: 0 },
    estimatedCostPerPage: SAGEMAKER_OCR_PER_PAGE,
    strengths: [
      'General VLM: reasons about layout, not just transcribes it',
      'Strong multilingual coverage including CJK',
      'Can follow a task prompt rather than one fixed OCR schema',
    ],
    limitations: [
      'Needs a deployed SageMaker endpoint (GPU billed hourly, even idle)',
      '235B — the largest GPU footprint here, so the costliest to host',
      'Not benchmarked on the 336-page grid study as thoroughly as the OCR set',
    ],
  },

};

// ─── Capability Support Matrix ────────────────────────────────────────────────

export type SupportLevel = 'excellent' | 'good' | 'limited' | 'none';

// Derived from skill .md support fields (transposed: capability→family → family→capability)
function buildCapabilitySupport(): Record<MethodFamily, Partial<Record<Capability, SupportLevel>>> {
  const matrix: Record<string, Partial<Record<string, SupportLevel>>> = {};
  for (const family of METHOD_FAMILIES) {
    matrix[family] = {};
  }
  for (const [capId, skill] of Object.entries(SKILL_INFO)) {
    for (const [family, level] of Object.entries(skill.support)) {
      if (matrix[family]) {
        matrix[family][capId] = level as SupportLevel;
      }
    }
  }
  return matrix as Record<MethodFamily, Partial<Record<Capability, SupportLevel>>>;
}

export const CAPABILITY_SUPPORT = buildCapabilitySupport();


// ─── Language Compatibility ──────────────────────────────────────────────────

/** BDA and Textract produce garbled output for non-English documents.
 *  Filter based on PRIMARY language — if the document is mostly English
 *  with minor non-English elements, keep BDA/Textract available. */
export function isMethodLanguageCompatible(method: ProcessingMethod, languages: string[]): boolean {
  if (!languages.length) return true;

  const normalized = languages.map((l) => l.toLowerCase().trim());
  const primary = normalized[0];

  // Primary language is English → all methods work
  // (even if secondary languages include non-English)
  if (primary.startsWith('en') || primary === 'english') return true;

  // All languages are English → all methods work
  if (normalized.every((l) => l.startsWith('en') || l === 'english')) return true;

  // Primary language is non-English → exclude BDA/Textract/Guardrails families
  // (Guardrails PII detectors are English-language-trained; non-English output is unreliable.)
  const family = METHOD_INFO[method].family;
  return (
    family !== 'bda' &&
    family !== 'bda-llm' &&
    family !== 'textract-llm' &&
    family !== 'guardrails'
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getMethodFamily(method: ProcessingMethod): MethodFamily {
  return METHOD_INFO[method].family;
}

export function getMethodsByFamily(family: MethodFamily): MethodInfo[] {
  return Object.values(METHOD_INFO).filter((m) => m.family === family);
}

// PII-specialist capabilities are best handled by Bedrock Guardrails
// (deterministic, policy-driven, no LLM hallucination). When both Guardrails
// and a general LLM score 'excellent', prefer Guardrails as the tie-breaker.
const PII_SPECIALIST_CAPABILITIES = new Set<string>(['pii_detection', 'pii_redaction']);

/**
 * Relative model strength WITHIN a family. Higher is more capable.
 *
 * Capability support is declared per FAMILY, so all seven Claude methods report
 * the same `excellent` for text_extraction. That made every tie fall through to
 * `Object.entries(METHOD_INFO)` declaration order, so `claude-sonnet` — merely
 * the first Claude declared — won every Claude tie and the "accuracy" strategy
 * could never select Opus 5 for anything. Measured over 18 document kinds × 4
 * strategies, only 8 of 22 methods were ever suggested: no GPT tier and no
 * frontier Claude model appeared even once.
 *
 * This is a deliberate ordering of model tiers, not a quality score: it only
 * breaks ties inside one family at one support level.
 */
const MODEL_TIER: Partial<Record<ProcessingMethod, number>> = {
  // Claude: frontier Opus > Opus 4.x > Sonnet 5 > Sonnet 4.6 > Haiku.
  'claude-opus-5': 60,
  'claude-opus-4-8': 55,
  'claude-opus-4-7': 50,
  'claude-opus': 45,
  'claude-sonnet-5': 40,
  'claude-sonnet': 30,
  'claude-haiku': 20,
  // GPT via Mantle: sol (largest) > 5.5 > terra > luna.
  'gpt-5-6-sol': 50,
  'gpt-5-5': 45,
  'gpt-5-6-terra': 35,
  'gpt-5-6-luna': 25,
  // Hybrids: a stronger structuring model makes the pair stronger.
  'bda-claude-sonnet': 40,
  'bda-claude-haiku': 30,
  'bda-nova-lite': 20,
  'textract-claude-sonnet': 40,
  'textract-claude-haiku': 30,
  'textract-nova-lite': 20,
  // Managed pipelines: a custom blueprint beats the standard schema.
  'bda-custom': 40,
  'bda-standard': 30,
};

/**
 * Methods that can perform `capability`, best first.
 *
 * Ordered by declared support level, then — within the same level — by relative
 * model strength, so "optimize for accuracy" actually reaches the frontier tiers
 * instead of stopping at whichever method happened to be declared first.
 */
/**
 * Per-METHOD overrides on top of the per-family baseline.
 *
 * `CAPABILITY_SUPPORT` is keyed by family, so every Claude tier shares one value
 * and every GPT tier shares another. That is right for most capabilities — the
 * approach is what matters — but it cannot express a real difference between tiers
 * within a family, and for spatially grounded tasks that difference is large:
 * a frontier model returns usable coordinates where a small fast tier does not.
 *
 * Only deviations are listed; anything absent inherits its family's level. Keep
 * this table small and evidence-backed — it exists to record measured differences,
 * not to hand-tune every cell.
 */
export const CAPABILITY_SUPPORT_OVERRIDES: Partial<
  Record<ProcessingMethod, Partial<Record<Capability, SupportLevel>>>
> = {
  /*
   * Bounding boxes. Validated over 336 real scanned pages in the hybrid
   * vision + spatial reasoning pattern: the frontier tiers return tight, usable
   * boxes on a 0-1000 normalized grid, while the small/fast tiers do not hold
   * spatial consistency across a dense page. The family baseline stays at the
   * conservative level, and the capable tiers are raised here.
   */
  'gpt-5-6-sol': { bounding_box: 'excellent' },
  'gpt-5-6-terra': { bounding_box: 'excellent' },
  'gpt-5-6-luna': { bounding_box: 'excellent' },
  'gpt-5-5': { bounding_box: 'good' },
  'claude-opus-5': { bounding_box: 'excellent' },
  'claude-opus-4-8': { bounding_box: 'excellent' },
  'claude-opus-4-7': { bounding_box: 'good' },
  'claude-sonnet-5': { bounding_box: 'good' },
};

/**
 * Support level for one (method, capability) pair — the single accessor the
 * matrix, the ranking and the UI all read, so they cannot disagree.
 *
 * Resolution order: per-method override, then the method's family baseline.
 */
export function getSupportLevel(
  method: ProcessingMethod,
  capability: Capability,
): SupportLevel | undefined {
  const override = CAPABILITY_SUPPORT_OVERRIDES[method]?.[capability];
  if (override) return override;
  return CAPABILITY_SUPPORT[METHOD_INFO[method].family]?.[capability];
}

export function getBestMethodsForCapability(capability: Capability): ProcessingMethod[] {
  const results: { method: ProcessingMethod; level: SupportLevel }[] = [];
  for (const method of Object.keys(METHOD_INFO) as ProcessingMethod[]) {
    // Via getSupportLevel so a per-method override actually changes the ranking,
    // not just what the matrix displays.
    const support = getSupportLevel(method, capability);
    if (support && support !== 'none') {
      results.push({ method, level: support });
    }
  }
  const order: Record<SupportLevel, number> = { excellent: 0, good: 1, limited: 2, none: 3 };
  const isPiiSpecialist = PII_SPECIALIST_CAPABILITIES.has(capability);
  return results
    .sort((a, b) => {
      const levelDiff = order[a.level] - order[b.level];
      if (levelDiff !== 0) return levelDiff;
      // Tie-breaker 1: for PII capabilities, Guardrails wins within the same tier.
      if (isPiiSpecialist) {
        const aIsGuardrails = METHOD_INFO[a.method].family === 'guardrails';
        const bIsGuardrails = METHOD_INFO[b.method].family === 'guardrails';
        if (aIsGuardrails !== bIsGuardrails) return aIsGuardrails ? -1 : 1;
      }
      // Tie-breaker 2: stronger model first. Without this the winner is decided
      // by declaration order in METHOD_INFO.
      const tierDiff = (MODEL_TIER[b.method] ?? 0) - (MODEL_TIER[a.method] ?? 0);
      if (tierDiff !== 0) return tierDiff;
      return 0;
    })
    .map((r) => r.method);
}

// ─── Result Types ─────────────────────────────────────────────────────────────

export type ProcessingStatus = 'pending' | 'processing' | 'complete' | 'error';

export interface CapabilityResult {
  capability: Capability;
  data: unknown;
  confidence: number;
  format: 'html' | 'csv' | 'json' | 'text' | 'image' | 'markdown';
  /**
   * Which method's answer the pipeline aggregator selected for this capability.
   * Set only when an Aggregator node resolved competing answers, so the UI can
   * show WHY a particular result is displayed instead of presenting an
   * unattributed merge.
   */
  sourceMethod?: ProcessingMethod;
  /** Other methods that produced an answer for this capability. */
  alternativeMethods?: ProcessingMethod[];
}

export interface ProcessorResult {
  method: ProcessingMethod;
  status: ProcessingStatus;
  results: Record<string, CapabilityResult>;
  metrics: {
    latencyMs: number;
    cost: number;
    /** Mean of the model's SELF-REPORTED per-capability confidence. */
    confidence?: number;
    /**
     * Mean OCR confidence (0-1), measured by Textract per recognised line.
     *
     * Present only for methods with a real OCR stage. This is the one confidence
     * figure in the app that is measured rather than self-reported, so it is worth
     * distinguishing in the UI: it bounds what the downstream model can get right.
     */
    ocrConfidence?: number;
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  };
  rawOutput?: string;
  /**
   * The model stopped at its output-token ceiling instead of finishing, so this
   * result is a FRAGMENT.
   *
   * Reported because a truncated extraction is otherwise indistinguishable from a
   * complete one: the response was cut off mid-value (`data: - {"label": "Benchmark`
   * with no closing brace), parsed as far as it went, and shown with the model's own
   * confidence attached. Whatever is here may be usable, but it is not all of the
   * document, and the user has to be told which.
   */
  truncated?: boolean;
  error?: string;
}

export interface ComparisonResult {
  methods: {
    method: ProcessingMethod;
    metrics: { latencyMs: number; cost: number; confidence: number };
    rank: { speed: number; cost: number; confidence: number; overall: number };
  }[];
  recommendation: string;
  capabilityMatrix: Record<
    string,
    Record<string, { supported: boolean; quality: string }>
  >;
}
