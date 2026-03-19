import type { Capability } from './capabilities.js';

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
  'nova-lite',
  'nova-pro',
  'textract-claude-sonnet',
  'textract-claude-haiku',
  'textract-nova-lite',
  'textract-nova-pro',
  'nova-embeddings',
] as const;

export type ProcessingMethod = (typeof METHODS)[number];

export const METHOD_FAMILIES = ['bda', 'bda-llm', 'claude', 'nova', 'textract-llm', 'embeddings'] as const;
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
  estimatedCostPerPage: number;
  strengths: string[];
  limitations: string[];
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
    estimatedCostPerPage: 0.01,
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
    estimatedCostPerPage: 0.04,
    strengths: ['Custom schema', 'Field-level confidence', 'Explainability info'],
    limitations: ['Requires blueprint setup', 'Higher cost', 'No bounding boxes'],
  },

  // ─── BDA + LLM ──────────────────────────────────────────────────────────────
  'bda-claude-sonnet': {
    id: 'bda-claude-sonnet',
    family: 'bda-llm',
    name: 'BDA + Claude Sonnet',
    shortName: 'BDA+Sonnet',
    description: 'Amazon Bedrock Data Automation followed by Claude Sonnet 4.6 for enrichment',
    modelId: 'us.anthropic.claude-sonnet-4-6',
    tokenPricing: { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00 },
    estimatedCostPerPage: 0.025,
    strengths: ['BDA precision + Claude reasoning', 'Best hybrid accuracy', 'Structured enrichment'],
    limitations: ['Two-phase latency', 'Higher combined cost'],
  },
  'bda-claude-haiku': {
    id: 'bda-claude-haiku',
    family: 'bda-llm',
    name: 'BDA + Claude Haiku',
    shortName: 'BDA+Haiku',
    description: 'Amazon Bedrock Data Automation followed by Claude Haiku 4.5 for fast enrichment',
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    tokenPricing: { inputPer1MTokens: 1.00, outputPer1MTokens: 5.00 },
    estimatedCostPerPage: 0.014,
    strengths: ['BDA precision + fast LLM', 'Cost-effective hybrid', 'Good for simple structuring'],
    limitations: ['Haiku may miss complex patterns', 'Two-phase process'],
  },
  'bda-nova-lite': {
    id: 'bda-nova-lite',
    family: 'bda-llm',
    name: 'BDA + Nova 2 Lite',
    shortName: 'BDA+Nova',
    description: 'Amazon Bedrock Data Automation followed by Nova 2 Lite (GA) for enrichment',
    modelId: 'us.amazon.nova-2-lite-v1:0',
    tokenPricing: { inputPer1MTokens: 0.30, outputPer1MTokens: 2.50 },
    estimatedCostPerPage: 0.012,
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
    estimatedCostPerPage: 0.015,
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
    estimatedCostPerPage: 0.004,
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
    estimatedCostPerPage: 0.025,
    strengths: ['Highest accuracy', 'Best reasoning', '128k output', 'Complex analysis', 'Contract/legal', '1M context'],
    limitations: ['Highest cost', 'Moderate latency'],
  },

  // ─── Nova ───────────────────────────────────────────────────────────────────
  'nova-lite': {
    id: 'nova-lite',
    family: 'nova',
    name: 'Nova 2 Lite',
    shortName: 'Nova 2 Lite',
    description: 'Amazon Nova 2 Lite (GA) - fast, cost-effective multimodal with reasoning capabilities',
    modelId: 'us.amazon.nova-2-lite-v1:0',
    tokenPricing: { inputPer1MTokens: 0.30, outputPer1MTokens: 2.50 },
    estimatedCostPerPage: 0.002,
    strengths: ['GA model', 'Fastest Nova', 'Lowest cost', 'Reasoning capabilities', 'Good for batch'],
    limitations: ['Smaller model', 'Simpler extraction than Pro'],
  },
  'nova-pro': {
    id: 'nova-pro',
    family: 'nova',
    name: 'Nova 2 Pro (Preview)',
    shortName: 'Nova 2 Pro',
    description: 'Amazon Nova 2 Pro (Gated Preview) - strong multimodal with native bounding box support',
    modelId: 'us.amazon.nova-2-pro-preview-20251202-v1:0',
    tokenPricing: { inputPer1MTokens: 1.25, outputPer1MTokens: 10.00 },
    estimatedCostPerPage: 0.008,
    strengths: ['Native bounding boxes', 'Higher accuracy', 'Strong multimodal'],
    limitations: ['Gated Preview (no GA SLA)', 'Limited regional support', 'Quota limits (100 RPM)'],
  },

  // ─── Textract + LLM ────────────────────────────────────────────────────────
  'textract-claude-sonnet': {
    id: 'textract-claude-sonnet',
    family: 'textract-llm',
    name: 'Textract + Claude Sonnet',
    shortName: 'Txt+Sonnet',
    description: 'Amazon Textract OCR followed by Claude Sonnet 4.6 for structuring',
    modelId: 'us.anthropic.claude-sonnet-4-6',
    tokenPricing: { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00 },
    estimatedCostPerPage: 0.017,
    strengths: ['Textract precision + Claude reasoning', 'Great for forms', 'Native table detection'],
    limitations: ['Two-step latency', 'Higher combined cost'],
  },
  'textract-claude-haiku': {
    id: 'textract-claude-haiku',
    family: 'textract-llm',
    name: 'Textract + Claude Haiku',
    shortName: 'Txt+Haiku',
    description: 'Amazon Textract OCR followed by Claude Haiku 4.5 for fast structuring',
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    tokenPricing: { inputPer1MTokens: 1.00, outputPer1MTokens: 5.00 },
    estimatedCostPerPage: 0.006,
    strengths: ['Textract precision + fast LLM', 'Cost-effective hybrid', 'Good for simple forms'],
    limitations: ['Haiku may miss complex patterns', 'Two-step process'],
  },
  'textract-nova-lite': {
    id: 'textract-nova-lite',
    family: 'textract-llm',
    name: 'Textract + Nova 2 Lite',
    shortName: 'Txt+Nova',
    description: 'Amazon Textract OCR followed by Nova 2 Lite (GA) for structuring',
    modelId: 'us.amazon.nova-2-lite-v1:0',
    tokenPricing: { inputPer1MTokens: 0.30, outputPer1MTokens: 2.50 },
    estimatedCostPerPage: 0.005,
    strengths: ['Textract precision + Nova speed', 'Lowest cost hybrid', 'GA models only', 'Good for batch'],
    limitations: ['Lite model for structuring', 'Two-step process'],
  },
  'textract-nova-pro': {
    id: 'textract-nova-pro',
    family: 'textract-llm',
    name: 'Textract + Nova 2 Pro (Preview)',
    shortName: 'Txt+Nova Pro',
    description: 'Amazon Textract OCR followed by Nova 2 Pro (Gated Preview) for structuring',
    modelId: 'us.amazon.nova-2-pro-preview-20251202-v1:0',
    tokenPricing: { inputPer1MTokens: 1.25, outputPer1MTokens: 10.00 },
    estimatedCostPerPage: 0.01,
    strengths: ['Textract precision + Nova Pro accuracy', 'Better structuring than Lite', 'Native bbox support'],
    limitations: ['Nova Pro is Gated Preview', 'Two-step process', 'Limited regional support'],
  },

  // ─── Embeddings ──────────────────────────────────────────────────────────────
  'nova-embeddings': {
    id: 'nova-embeddings',
    family: 'embeddings',
    name: 'Nova Multimodal Embeddings',
    shortName: 'Nova Embed',
    description: 'Amazon Nova 2 Multimodal Embeddings — state-of-the-art unified embedding model for text, documents, images, video, and audio. Enables crossmodal semantic search and RAG.',
    modelId: 'amazon.nova-2-multimodal-embeddings-v1:0',
    tokenPricing: { inputPer1MTokens: 0.018, outputPer1MTokens: 0 },
    estimatedCostPerPage: 0.0002,
    strengths: ['Unified multimodal embeddings', 'Text+image+doc+video+audio', 'Crossmodal search', '4 dimension options (256-3072)', 'Batch inference', 'Segmentation for long content'],
    limitations: ['us-east-1 only', 'Embedding only (no generation)', '8K token context for text'],
  },
};

// ─── Capability Support Matrix ────────────────────────────────────────────────

export type SupportLevel = 'excellent' | 'good' | 'limited' | 'none';

export const CAPABILITY_SUPPORT: Record<MethodFamily, Partial<Record<Capability, SupportLevel>>> = {
  bda: {
    // Verified against BDA documentation (2026-03)
    text_extraction: 'excellent',     // plain text, markdown, HTML output
    handwriting_extraction: 'good',   // supports handwritten + printed
    table_extraction: 'excellent',    // HTML, CSV, headers, footers, crop images
    kv_extraction: 'good',            // form fields; excellent with custom blueprints
    entity_extraction: 'good',        // via custom blueprints
    image_description: 'good',        // generative figure captions
    bounding_box: 'excellent',        // all elements: text, tables, figures, words
    signature_detection: 'limited',   // not a dedicated feature
    barcode_qr: 'none',              // not supported
    layout_analysis: 'excellent',     // element-level with reading order, sub-types
    document_classification: 'good',  // via custom blueprints
    document_splitting: 'excellent',  // up to 3000 pages with splitter
    document_summarization: 'excellent', // 10-word + 250-word generative summaries
    language_detection: 'good',       // dominant language detection in audio
    pii_detection: 'limited',         // not a dedicated feature
    pii_redaction: 'none',           // not supported
    invoice_processing: 'excellent',  // pre-defined blueprints
    receipt_parsing: 'excellent',     // pre-defined blueprints
    check_processing: 'good',        // via custom blueprints
    insurance_claims: 'good',         // via custom blueprints
    medical_records: 'good',          // via custom blueprints
    contract_analysis: 'limited',     // basic text extraction only
    // Media (BDA exclusive)
    video_summarization: 'excellent',      // full video + chapter summaries, speaker ID
    video_chapter_extraction: 'excellent', // scene segmentation, IAB classification
    audio_transcription: 'excellent',      // 11 languages, speaker labeling, 30 speakers
    audio_summarization: 'excellent',      // topic-based summaries with timestamps
    content_moderation: 'excellent',       // 7 categories: image, video, audio
    // Advanced AI
    image_separation: 'good',              // BDA can extract figures/images from documents
    embedding_generation: 'none',
    knowledge_base_ingestion: 'none',
    pdf_conversion: 'none',
    format_standardization: 'none',
    ocr_enhancement: 'none',
  },
  'bda-llm': {
    // BDA extraction + LLM enrichment — inherits BDA's extraction strengths with LLM structuring
    text_extraction: 'excellent',
    handwriting_extraction: 'excellent',
    table_extraction: 'excellent',
    kv_extraction: 'excellent',
    entity_extraction: 'excellent',
    image_description: 'excellent',
    bounding_box: 'excellent',
    signature_detection: 'good',
    barcode_qr: 'limited',
    layout_analysis: 'excellent',
    document_classification: 'excellent',
    document_splitting: 'excellent',
    document_summarization: 'excellent',
    language_detection: 'excellent',
    pii_detection: 'excellent',
    pii_redaction: 'good',
    invoice_processing: 'excellent',
    receipt_parsing: 'excellent',
    check_processing: 'excellent',
    insurance_claims: 'excellent',
    medical_records: 'excellent',
    contract_analysis: 'excellent',
    video_summarization: 'excellent',
    video_chapter_extraction: 'excellent',
    audio_transcription: 'excellent',
    audio_summarization: 'excellent',
    content_moderation: 'excellent',
    image_separation: 'excellent',
    embedding_generation: 'none',
    knowledge_base_ingestion: 'none',
    pdf_conversion: 'none',
    format_standardization: 'none',
    ocr_enhancement: 'none',
  },
  claude: {
    text_extraction: 'excellent',
    handwriting_extraction: 'excellent',
    table_extraction: 'excellent',
    kv_extraction: 'excellent',
    entity_extraction: 'excellent',
    image_description: 'excellent',
    bounding_box: 'limited',
    signature_detection: 'good',
    barcode_qr: 'limited',
    layout_analysis: 'good',
    document_classification: 'excellent',
    document_splitting: 'good',
    document_summarization: 'excellent',
    language_detection: 'excellent',
    pii_detection: 'excellent',
    pii_redaction: 'excellent',
    invoice_processing: 'excellent',
    receipt_parsing: 'excellent',
    check_processing: 'excellent',
    insurance_claims: 'excellent',
    medical_records: 'excellent',
    contract_analysis: 'excellent',
    // Media — LLM can analyze video/audio if transcribed, but no native processing
    video_summarization: 'none',
    video_chapter_extraction: 'none',
    audio_transcription: 'none',
    audio_summarization: 'none',
    content_moderation: 'good',        // can detect via vision
    // Advanced AI
    image_separation: 'good',          // vision can identify and describe embedded images
    embedding_generation: 'none',
    knowledge_base_ingestion: 'none',
    pdf_conversion: 'none',
    format_standardization: 'none',
    ocr_enhancement: 'none',
  },
  nova: {
    text_extraction: 'good',
    handwriting_extraction: 'good',
    table_extraction: 'good',
    kv_extraction: 'good',
    entity_extraction: 'good',
    image_description: 'good',
    bounding_box: 'excellent',
    signature_detection: 'good',
    barcode_qr: 'good',
    layout_analysis: 'excellent',
    document_classification: 'good',
    document_splitting: 'good',
    document_summarization: 'good',
    language_detection: 'good',
    pii_detection: 'good',
    pii_redaction: 'good',
    invoice_processing: 'good',
    receipt_parsing: 'good',
    check_processing: 'good',
    insurance_claims: 'good',
    medical_records: 'good',
    contract_analysis: 'good',
    video_summarization: 'none',
    video_chapter_extraction: 'none',
    audio_transcription: 'none',
    audio_summarization: 'none',
    content_moderation: 'good',        // can detect via vision
    // Advanced AI
    image_separation: 'good',          // Nova vision can identify embedded images
    embedding_generation: 'none',
    knowledge_base_ingestion: 'none',
    pdf_conversion: 'none',
    format_standardization: 'none',
    ocr_enhancement: 'none',
  },
  'textract-llm': {
    text_extraction: 'excellent',
    handwriting_extraction: 'excellent',
    table_extraction: 'excellent',
    kv_extraction: 'excellent',
    entity_extraction: 'good',
    image_description: 'none',
    bounding_box: 'good',
    signature_detection: 'good',
    barcode_qr: 'none',
    layout_analysis: 'excellent',
    document_classification: 'good',
    document_splitting: 'good',
    document_summarization: 'good',
    language_detection: 'good',
    pii_detection: 'good',
    pii_redaction: 'good',
    invoice_processing: 'excellent',
    receipt_parsing: 'excellent',
    check_processing: 'excellent',
    insurance_claims: 'good',
    medical_records: 'good',
    contract_analysis: 'good',
    video_summarization: 'none',
    video_chapter_extraction: 'none',
    audio_transcription: 'none',
    audio_summarization: 'none',
    content_moderation: 'none',
    // Advanced AI
    image_separation: 'none',
    embedding_generation: 'none',
    knowledge_base_ingestion: 'none',
    pdf_conversion: 'none',
    format_standardization: 'none',
    ocr_enhancement: 'limited',
  },
  embeddings: {
    text_extraction: 'none',
    handwriting_extraction: 'none',
    table_extraction: 'none',
    kv_extraction: 'none',
    entity_extraction: 'none',
    image_description: 'none',
    bounding_box: 'none',
    signature_detection: 'none',
    barcode_qr: 'none',
    layout_analysis: 'none',
    document_classification: 'none',
    document_splitting: 'none',
    document_summarization: 'none',
    language_detection: 'none',
    pii_detection: 'none',
    pii_redaction: 'none',
    invoice_processing: 'none',
    receipt_parsing: 'none',
    check_processing: 'none',
    insurance_claims: 'none',
    medical_records: 'none',
    contract_analysis: 'none',
    video_summarization: 'none',
    video_chapter_extraction: 'none',
    audio_transcription: 'none',
    audio_summarization: 'none',
    content_moderation: 'none',
    // Advanced AI — embeddings excel here
    image_separation: 'none',
    embedding_generation: 'excellent',
    knowledge_base_ingestion: 'good',
    pdf_conversion: 'none',
    format_standardization: 'none',
    ocr_enhancement: 'none',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getMethodFamily(method: ProcessingMethod): MethodFamily {
  return METHOD_INFO[method].family;
}

export function getMethodsByFamily(family: MethodFamily): MethodInfo[] {
  return Object.values(METHOD_INFO).filter((m) => m.family === family);
}

export function getBestMethodsForCapability(capability: Capability): ProcessingMethod[] {
  const results: { method: ProcessingMethod; level: SupportLevel }[] = [];
  for (const [method, info] of Object.entries(METHOD_INFO)) {
    const family = info.family;
    const support = CAPABILITY_SUPPORT[family]?.[capability];
    if (support && support !== 'none') {
      results.push({ method: method as ProcessingMethod, level: support });
    }
  }
  const order: Record<SupportLevel, number> = { excellent: 0, good: 1, limited: 2, none: 3 };
  return results
    .sort((a, b) => order[a.level] - order[b.level])
    .map((r) => r.method);
}

// ─── Result Types ─────────────────────────────────────────────────────────────

export type ProcessingStatus = 'pending' | 'processing' | 'complete' | 'error';

export interface CapabilityResult {
  capability: Capability;
  data: unknown;
  confidence: number;
  format: 'html' | 'csv' | 'json' | 'text' | 'image' | 'markdown';
}

export interface ProcessorResult {
  method: ProcessingMethod;
  status: ProcessingStatus;
  results: Record<string, CapabilityResult>;
  metrics: {
    latencyMs: number;
    cost: number;
    confidence?: number;
  };
  rawOutput?: string;
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
