/**
 * Single Source of Truth: Method limits, capabilities, and constraints.
 * Used by interview logic, pipeline builder, preview, and architecture code generation.
 *
 * Sources:
 * - Amazon Bedrock API restrictions: https://docs.aws.amazon.com/bedrock/latest/userguide/api-restrictions.html
 * - BDA prerequisites: https://docs.aws.amazon.com/bedrock/latest/userguide/bda-prerequisites.html
 * - BDA standard output (document/image/video/audio)
 * - Anthropic Claude docs: vision, PDF support
 * - Amazon Textract limits
 */

// ─── Converse API (Claude, Nova) ────────────────────────────────────────────

export const CONVERSE_API_LIMITS = {
  maxDocumentsPerRequest: 5,
  maxDocumentSizeMB: 4.5, // 4.5MB per document
  maxDocumentSizeMB_Claude4_PDF: null, // No limit for PDF on Claude 4+
  maxDocumentSizeMB_Nova_PDF_DOCX: null, // No limit for PDF/DOCX on Nova
  maxImagePixels: 8000, // 8000x8000 px (Anthropic Claude)
  maxPDFPages_Anthropic: 100, // Claude: max 100 PDF pages per request
  maxRequestSizeMB_Anthropic: 32, // Anthropic Messages: 32MB max request
  supportedDocFormats: ['pdf', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'html', 'txt', 'md'],
  supportedImageFormats: ['jpeg', 'png', 'gif', 'webp'],
  notes: [
    'Documents only allowed in user role messages',
    'Claude 4+ has no 4.5MB limit for PDF format',
    'Nova has no 4.5MB limit for PDF and DOCX formats',
    'InvokeModel does not support documents - use Converse/ConverseStream',
  ],
} as const;

// ─── BDA (Bedrock Data Automation) ──────────────────────────────────────────

export const BDA_LIMITS = {
  async: {
    maxPageCount_Console: 20,
    maxPageCount_WithSplitter: 3000,
    maxFileSizeMB_Console: 200,
    maxFileSizeMB_API: 500,
    supportedFormats: ['pdf', 'tiff', 'jpeg', 'png', 'docx'],
    maxHeightInches: 40,
    maxWidthPoints: 9000,
    minTextHeightPixels: 15, // min 15px text height (8pt at 150 DPI)
    notes: [
      'PDF cannot be password-protected',
      'DOCX is converted to PDF for processing',
      'Supports handwritten and printed text',
      'Horizontal text only (no vertical CJK)',
      'Supports all in-plane document rotations',
      'Max image resolution: 10000px per side',
    ],
  },
  sync: {
    maxPageCount: 20,
    supportedFormats: ['pdf', 'tiff', 'jpeg', 'png'],
    notes: [
      'DOCX not supported in sync API',
      'No CSV/crop images in sync output',
      'JSON output only (no additional files)',
    ],
  },
  blueprints: {
    maxPerProject: 40,
    maxProjectsPerAccount: 100,
    maxBlueprintsPerAccount: 1000,
    maxVersions: 100,
    maxLeafFields: 100,
    maxListLeafFields: 30,
    maxNameLength: 60,
    maxFieldDescriptionLength_Document: 600,
    maxFieldDescriptionLength_Other: 500,
    maxFieldNameLength: 60,
    maxBlueprintSizeChars: 100000,
  },
  image: {
    maxFileSizeMB: 5,
    maxResolution: 8000,
    supportedFormats: ['jpeg', 'png'],
  },
  video: {
    maxFileSizeMB: 10240,
    maxDurationMinutes: 240,
    supportedFormats: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
    supportedCodecs: ['h264', 'h265', 'vp8', 'vp9', 'av1', 'mpeg4'],
    minResolution: 224,
    maxResolution: 7680,
    minFPS: 1,
    maxFPS: 60,
    maxBlueprintsPerProject: 1,
  },
  audio: {
    maxFileSizeMB: 2048,
    maxDurationMinutes: 240,
    minDurationMs: 500,
    supportedFormats: ['amr', 'flac', 'm4a', 'mp3', 'ogg', 'wav'],
    minSampleRateHz: 8000,
    maxSampleRateHz: 48000,
    maxChannels: 2,
    maxBlueprintsPerProject: 1,
    supportedLanguages: ['en', 'de', 'es', 'fr', 'it', 'pt', 'ja', 'ko', 'zh', 'zh-tw', 'yue'],
  },
  pricing: {
    standard: 0.01, // $/page
    custom: 0.04,   // $/page
  },
} as const;

// ─── BDA Standard Output Capabilities ───────────────────────────────────────

export const BDA_STANDARD_OUTPUT = {
  document: {
    granularity: ['page', 'element', 'word'] as const,
    textFormats: ['plain_text', 'markdown', 'html', 'csv'] as const,
    outputFormats: ['json', 'json_plus'] as const,
    features: {
      boundingBoxes: true,
      generativeSummary: true, // 10-word and 250-word summaries
      figureCaptions: true,
      hyperlinks: true, // PDF only
      tableCSV: true, // async only
      cropImages: true, // async only, for tables and figures
      rectifiedImages: true,
    },
    entityTypes: ['TEXT', 'TABLE', 'FIGURE'] as const,
    textSubTypes: ['TITLE', 'SECTION_TITLE', 'HEADER', 'FOOTER', 'PARAGRAPH', 'LIST', 'PAGE_NUMBER'] as const,
  },
  image: {
    features: {
      summary: true, // default enabled
      iabClassification: true,
      logoDetection: true, // not default
      textDetection: true, // default enabled
      contentModeration: true,
      boundingBoxes: true,
    },
    moderationCategories: [
      'explicit_nudity', 'non_explicit_nudity_and_kissing',
      'swimwear_or_underwear', 'violence',
      'drugs_and_tobacco', 'alcohol', 'hate_symbols',
    ],
  },
  video: {
    features: {
      fullVideoSummary: true, // default enabled
      chapterSummary: true, // default enabled
      iabClassification: true,
      audioTranscript: true,
      textDetection: true, // default enabled
      logoDetection: true, // not default
      contentModeration: true,
      speakerIdentification: true,
    },
  },
  audio: {
    features: {
      fullSummary: true,
      fullTranscript: true,
      speakerLabeling: true,
      channelLabeling: true,
      topicSummary: true, // not default
      contentModeration: true,
    },
    moderationCategories: [
      'profanity', 'hate_speech', 'sexual', 'insults',
      'violence_or_threats', 'graphic', 'harassment_or_abuse',
    ],
  },
} as const;

// ─── Textract ───────────────────────────────────────────────────────────────

export const TEXTRACT_LIMITS = {
  analyzeDocument: {
    maxFileSizeMB: 10,
    maxPageCount: 1, // single page per call
    supportedFormats: ['jpeg', 'png', 'pdf', 'tiff'],
    features: ['TABLES', 'FORMS', 'SIGNATURES', 'LAYOUT'] as const,
    pricing: 0.0015, // $/page for AnalyzeDocument
  },
  detectText: {
    maxFileSizeMB: 10,
    supportedFormats: ['jpeg', 'png', 'pdf', 'tiff'],
    pricing: 0.0015, // $/page
  },
  startDocumentAnalysis: {
    maxFileSizeMB: 500,
    maxPageCount: 3000,
    supportedFormats: ['pdf', 'tiff'],
    notes: ['Async only', 'S3 input required'],
  },
} as const;

// ─── Method Capability Matrix (summary for interview/pipeline) ──────────────

export type MethodLimitKey = 'converse' | 'bda-async' | 'bda-sync' | 'textract';

export interface MethodConstraintSummary {
  key: MethodLimitKey;
  name: string;
  maxDocSizeMB: number | null;
  maxPages: number | null;
  supportedFormats: readonly string[];
  supportsStreaming: boolean;
  requiresS3: boolean;
  estimatedLatencyMs: { min: number; max: number };
  bestFor: string[];
  limitations: string[];
}

export const METHOD_CONSTRAINTS: MethodConstraintSummary[] = [
  {
    key: 'converse',
    name: 'Bedrock Converse API (Claude/Nova)',
    maxDocSizeMB: 4.5, // null for Claude4+ PDF
    maxPages: 100,
    supportedFormats: ['pdf', 'jpeg', 'png', 'gif', 'webp', 'docx'],
    supportsStreaming: true,
    requiresS3: false,
    estimatedLatencyMs: { min: 2000, max: 10000 },
    bestFor: [
      'Complex document understanding',
      'Multi-capability extraction in single call',
      'Handwriting recognition',
      'Contract/medical/insurance analysis',
      'PII detection and redaction',
      'Document summarization',
    ],
    limitations: [
      '4.5MB doc limit (except PDF on Claude 4+)',
      '100 PDF pages max (Anthropic)',
      '5 documents per request',
      '8000x8000px max image size',
      'Token-based pricing (varies by document size)',
    ],
  },
  {
    key: 'bda-async',
    name: 'Bedrock Data Automation (Async)',
    maxDocSizeMB: 500,
    maxPages: 3000,
    supportedFormats: ['pdf', 'tiff', 'jpeg', 'png', 'docx'],
    supportsStreaming: false,
    requiresS3: true,
    estimatedLatencyMs: { min: 5000, max: 30000 },
    bestFor: [
      'High-volume document processing',
      'Invoice and receipt extraction',
      'Document splitting (up to 3000 pages)',
      'Table extraction with CSV output',
      'Figure/chart extraction with crop images',
      'Video/audio processing',
    ],
    limitations: [
      'Async only (poll for results)',
      'Requires S3 for input and output',
      'No vertical text (CJK)',
      'Custom blueprints: max 40 per project',
      'Fixed per-page pricing',
    ],
  },
  {
    key: 'bda-sync',
    name: 'Bedrock Data Automation (Sync)',
    maxDocSizeMB: 200,
    maxPages: 20,
    supportedFormats: ['pdf', 'tiff', 'jpeg', 'png'],
    supportsStreaming: false,
    requiresS3: false,
    estimatedLatencyMs: { min: 3000, max: 15000 },
    bestFor: [
      'Real-time document processing',
      'Single-page extraction',
      'Quick previews',
    ],
    limitations: [
      '20 pages max',
      'No DOCX support',
      'No CSV/crop image output',
      'JSON output only',
    ],
  },
  {
    key: 'textract',
    name: 'Amazon Textract',
    maxDocSizeMB: 10,
    maxPages: 1, // per AnalyzeDocument call
    supportedFormats: ['jpeg', 'png', 'pdf', 'tiff'],
    supportsStreaming: false,
    requiresS3: false,
    estimatedLatencyMs: { min: 1000, max: 5000 },
    bestFor: [
      'OCR (text detection)',
      'Table structure extraction',
      'Form field extraction (key-value pairs)',
      'Signature detection',
      'Layout analysis',
      'Bounding box coordinates',
      'Check processing (MICR)',
    ],
    limitations: [
      '1 page per AnalyzeDocument call',
      'Async API needed for multi-page (S3 required)',
      'No document understanding/summarization',
      'No classification or splitting',
      'Requires LLM post-processing for structured extraction',
    ],
  },
];

/**
 * Get constraints for a specific method family.
 * Used in pipeline builder and interview logic.
 */
export function getMethodConstraints(key: MethodLimitKey): MethodConstraintSummary | undefined {
  return METHOD_CONSTRAINTS.find((c) => c.key === key);
}

/**
 * Get a formatted summary of limits for use in LLM prompts.
 */
export function getMethodLimitsSummary(): string {
  return METHOD_CONSTRAINTS.map((c) => {
    return [
      `**${c.name}**`,
      `- Max doc size: ${c.maxDocSizeMB ? `${c.maxDocSizeMB}MB` : 'No limit'}`,
      `- Max pages: ${c.maxPages ?? 'No limit'}`,
      `- Formats: ${c.supportedFormats.join(', ')}`,
      `- Streaming: ${c.supportsStreaming ? 'Yes' : 'No'}`,
      `- S3 required: ${c.requiresS3 ? 'Yes' : 'No'}`,
      `- Best for: ${c.bestFor.join('; ')}`,
      `- Limitations: ${c.limitations.join('; ')}`,
    ].join('\n');
  }).join('\n\n');
}
