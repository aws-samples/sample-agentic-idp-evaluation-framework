// ─── Capability Categories ───────────────────────────────────────────────────

export const CAPABILITY_CATEGORIES = [
  'core_extraction',
  'visual_analysis',
  'document_intelligence',
  'compliance_security',
  'industry_specific',
  'media_processing',
  'advanced_ai',
  'document_conversion',
] as const;

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

export interface CategoryInfo {
  id: CapabilityCategory;
  name: string;
  description: string;
  color: string;
}

export const CATEGORY_INFO: Record<CapabilityCategory, CategoryInfo> = {
  core_extraction: {
    id: 'core_extraction',
    name: 'Core Extraction',
    description: 'Fundamental text, table, and data extraction from documents',
    color: '#0972d3',
  },
  visual_analysis: {
    id: 'visual_analysis',
    name: 'Visual Analysis',
    description: 'Image, layout, and spatial element detection',
    color: '#037f0c',
  },
  document_intelligence: {
    id: 'document_intelligence',
    name: 'Document Intelligence',
    description: 'Classification, summarization, and document understanding',
    color: '#8b5cf6',
  },
  compliance_security: {
    id: 'compliance_security',
    name: 'Compliance & Security',
    description: 'PII detection, redaction, and data protection',
    color: '#d91515',
  },
  industry_specific: {
    id: 'industry_specific',
    name: 'Industry-Specific',
    description: 'Specialized extraction for invoices, checks, medical records, and more',
    color: '#ec7211',
  },
  media_processing: {
    id: 'media_processing',
    name: 'Media Processing',
    description: 'Video summarization, audio transcription, and content moderation via BDA',
    color: '#9469d6',
  },
  advanced_ai: {
    id: 'advanced_ai',
    name: 'Advanced AI',
    description: 'Image separation, multimodal embeddings, and knowledge base integration',
    color: '#2563eb',
  },
  document_conversion: {
    id: 'document_conversion',
    name: 'Document Conversion',
    description: 'Format conversion, PDF generation, and OCR preprocessing',
    color: '#7c3aed',
  },
};

// ─── Capabilities ────────────────────────────────────────────────────────────

export const CAPABILITIES = [
  // Core Extraction
  'text_extraction',
  'handwriting_extraction',
  'table_extraction',
  'kv_extraction',
  'entity_extraction',
  // Visual Analysis
  'image_description',
  'bounding_box',
  'signature_detection',
  'barcode_qr',
  'layout_analysis',
  // Document Intelligence
  'document_classification',
  'document_splitting',
  'document_summarization',
  'language_detection',
  // Compliance & Security
  'pii_detection',
  'pii_redaction',
  // Industry-Specific
  'invoice_processing',
  'receipt_parsing',
  'check_processing',
  'insurance_claims',
  'medical_records',
  'contract_analysis',
  // Media Processing
  'video_summarization',
  'video_chapter_extraction',
  'audio_transcription',
  'audio_summarization',
  'content_moderation',
  // Advanced AI
  'image_separation',
  'embedding_generation',
  'knowledge_base_ingestion',
  // Document Conversion & Programmatic
  'pdf_conversion',
  'format_standardization',
  'ocr_enhancement',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface CapabilityInfo {
  id: Capability;
  name: string;
  description: string;
  category: CapabilityCategory;
  icon: string;
  tags: string[];
  exampleInput: string;
  exampleOutput: string;
}

export const CAPABILITY_INFO: Record<Capability, CapabilityInfo> = {
  // ─── Core Extraction ────────────────────────────────────────────────────────
  text_extraction: {
    id: 'text_extraction',
    name: 'Text Extraction',
    description: 'Extract printed text from any document with layout preservation',
    category: 'core_extraction',
    icon: 'file-text',
    tags: ['text', 'ocr', 'printed', 'digital'],
    exampleInput: 'Scanned contract PDF',
    exampleOutput: 'Full text with paragraph structure',
  },
  handwriting_extraction: {
    id: 'handwriting_extraction',
    name: 'Handwriting Recognition',
    description: 'Recognize and extract handwritten text, notes, and annotations',
    category: 'core_extraction',
    icon: 'edit',
    tags: ['handwriting', 'cursive', 'annotations', 'notes'],
    exampleInput: 'Handwritten medical form',
    exampleOutput: 'Digitized text from handwritten fields',
  },
  table_extraction: {
    id: 'table_extraction',
    name: 'Table Extraction',
    description: 'Extract tables including nested, merged cells, and complex layouts to HTML or CSV',
    category: 'core_extraction',
    icon: 'table',
    tags: ['table', 'nested', 'merged', 'html', 'csv', 'structured'],
    exampleInput: 'Financial statement with nested tables',
    exampleOutput: 'HTML/CSV with preserved structure',
  },
  kv_extraction: {
    id: 'kv_extraction',
    name: 'Key-Value Pair Extraction',
    description: 'Extract structured key-value pairs from forms, labels, and field-based documents',
    category: 'core_extraction',
    icon: 'list',
    tags: ['form', 'fields', 'key-value', 'structured', 'labels'],
    exampleInput: 'Tax form W-2',
    exampleOutput: '{"employer_name": "...", "wages": "$...", "ssn": "***-**-****"}',
  },
  entity_extraction: {
    id: 'entity_extraction',
    name: 'Named Entity Extraction',
    description: 'Extract names, dates, monetary amounts, addresses, phone numbers, and emails',
    category: 'core_extraction',
    icon: 'user',
    tags: ['ner', 'names', 'dates', 'amounts', 'addresses', 'phone', 'email'],
    exampleInput: 'Business letter or contract',
    exampleOutput: '{"persons": [...], "dates": [...], "amounts": [...], "addresses": [...]}',
  },

  // ─── Visual Analysis ────────────────────────────────────────────────────────
  image_description: {
    id: 'image_description',
    name: 'Image & Chart Analysis',
    description: 'Describe and interpret images, charts, graphs, and diagrams within documents',
    category: 'visual_analysis',
    icon: 'image',
    tags: ['image', 'chart', 'graph', 'diagram', 'photo', 'visual'],
    exampleInput: 'Annual report with pie charts',
    exampleOutput: 'Detailed description of each chart with data points',
  },
  bounding_box: {
    id: 'bounding_box',
    name: 'Bounding Box Detection',
    description: 'Detect and locate elements with precise spatial coordinates (x, y, width, height)',
    category: 'visual_analysis',
    icon: 'crop',
    tags: ['bbox', 'coordinates', 'spatial', 'detection', 'region'],
    exampleInput: 'Yearbook page with photos',
    exampleOutput: '[{"label": "face", "x": 120, "y": 45, "w": 80, "h": 100}]',
  },
  signature_detection: {
    id: 'signature_detection',
    name: 'Signature Detection',
    description: 'Detect presence and location of signatures, initials, and stamps',
    category: 'visual_analysis',
    icon: 'pen-tool',
    tags: ['signature', 'initials', 'stamp', 'signed', 'notarized'],
    exampleInput: 'Signed contract',
    exampleOutput: '{"hasSignature": true, "locations": [...], "count": 2}',
  },
  barcode_qr: {
    id: 'barcode_qr',
    name: 'Barcode & QR Code',
    description: 'Detect and decode barcodes, QR codes, and data matrix codes',
    category: 'visual_analysis',
    icon: 'maximize',
    tags: ['barcode', 'qr', 'data-matrix', 'scan', 'code'],
    exampleInput: 'Shipping label with barcode',
    exampleOutput: '{"type": "QR", "data": "https://...", "location": {...}}',
  },
  layout_analysis: {
    id: 'layout_analysis',
    name: 'Layout Analysis',
    description: 'Detect reading order, columns, sections, headers, footers, and page structure',
    category: 'visual_analysis',
    icon: 'layout',
    tags: ['layout', 'columns', 'sections', 'headers', 'footers', 'reading-order'],
    exampleInput: 'Multi-column newspaper article',
    exampleOutput: '{"sections": [...], "readingOrder": [...], "columns": 2}',
  },

  // ─── Document Intelligence ──────────────────────────────────────────────────
  document_classification: {
    id: 'document_classification',
    name: 'Document Classification',
    description: 'Automatically classify document type (invoice, contract, form, letter, etc.)',
    category: 'document_intelligence',
    icon: 'folder',
    tags: ['classify', 'categorize', 'type', 'identification'],
    exampleInput: 'Unknown document',
    exampleOutput: '{"type": "invoice", "confidence": 0.95, "subtype": "utility_bill"}',
  },
  document_splitting: {
    id: 'document_splitting',
    name: 'Document Splitting',
    description: 'Split multi-document PDFs into logical documents with page-level classification',
    category: 'document_intelligence',
    icon: 'scissors',
    tags: ['split', 'multi-document', 'page-classification', 'boundaries'],
    exampleInput: '50-page PDF with mixed documents',
    exampleOutput: '[{"pages": [1,2], "type": "invoice"}, {"pages": [3,4,5], "type": "contract"}]',
  },
  document_summarization: {
    id: 'document_summarization',
    name: 'Document Summarization',
    description: 'Generate executive summaries, key points, and section-by-section analysis',
    category: 'document_intelligence',
    icon: 'align-left',
    tags: ['summary', 'key-points', 'abstract', 'executive-summary'],
    exampleInput: '20-page legal agreement',
    exampleOutput: 'Executive summary with key terms, obligations, and deadlines',
  },
  language_detection: {
    id: 'language_detection',
    name: 'Language Detection',
    description: 'Auto-detect document language and optionally translate content',
    category: 'document_intelligence',
    icon: 'globe',
    tags: ['language', 'detect', 'translate', 'multilingual', 'i18n'],
    exampleInput: 'Document in unknown language',
    exampleOutput: '{"language": "ko", "confidence": 0.98, "name": "Korean"}',
  },

  // ─── Compliance & Security ──────────────────────────────────────────────────
  pii_detection: {
    id: 'pii_detection',
    name: 'PII Detection',
    description: 'Detect personally identifiable information: SSN, credit cards, bank accounts, etc.',
    category: 'compliance_security',
    icon: 'shield',
    tags: ['pii', 'ssn', 'credit-card', 'bank-account', 'privacy', 'gdpr'],
    exampleInput: 'Customer application form',
    exampleOutput: '[{"type": "SSN", "value": "***-**-1234", "location": {...}}]',
  },
  pii_redaction: {
    id: 'pii_redaction',
    name: 'PII Redaction',
    description: 'Automatically redact PII from extracted text and generate sanitized output',
    category: 'compliance_security',
    icon: 'eye-off',
    tags: ['redact', 'sanitize', 'mask', 'anonymize', 'privacy'],
    exampleInput: 'Document with SSNs and addresses',
    exampleOutput: 'Same document with PII replaced by [REDACTED]',
  },

  // ─── Industry-Specific ─────────────────────────────────────────────────────
  invoice_processing: {
    id: 'invoice_processing',
    name: 'Invoice Processing',
    description: 'Extract line items, totals, taxes, discounts, vendor/buyer info from invoices',
    category: 'industry_specific',
    icon: 'file-text',
    tags: ['invoice', 'line-items', 'totals', 'vendor', 'ap', 'accounts-payable'],
    exampleInput: 'Vendor invoice PDF',
    exampleOutput: '{"vendor": "...", "lineItems": [...], "total": "$1,234.56", "tax": "$98.76"}',
  },
  receipt_parsing: {
    id: 'receipt_parsing',
    name: 'Receipt Parsing',
    description: 'Parse receipts for items, prices, totals, store info, and payment details',
    category: 'industry_specific',
    icon: 'shopping-cart',
    tags: ['receipt', 'items', 'prices', 'store', 'expense', 'reimbursement'],
    exampleInput: 'Restaurant receipt photo',
    exampleOutput: '{"store": "...", "items": [...], "subtotal": "$45.00", "tip": "$9.00"}',
  },
  check_processing: {
    id: 'check_processing',
    name: 'Check Processing',
    description: 'Extract courtesy/legal amounts, payee, date, memo, and MICR line from checks',
    category: 'industry_specific',
    icon: 'credit-card',
    tags: ['check', 'cheque', 'amount', 'payee', 'micr', 'banking'],
    exampleInput: 'Personal check image',
    exampleOutput: '{"courtesyAmount": "$500.00", "legalAmount": "Five hundred...", "payee": "..."}',
  },
  insurance_claims: {
    id: 'insurance_claims',
    name: 'Insurance Claims',
    description: 'Extract claim details, policy info, damage assessment, and coverage information',
    category: 'industry_specific',
    icon: 'shield',
    tags: ['insurance', 'claim', 'policy', 'coverage', 'damage', 'assessment'],
    exampleInput: 'Auto insurance claim form',
    exampleOutput: '{"claimId": "...", "policyNumber": "...", "damages": [...], "amount": "$..."}',
  },
  medical_records: {
    id: 'medical_records',
    name: 'Medical Records',
    description: 'Extract patient info, diagnoses (ICD codes), medications, and treatment plans',
    category: 'industry_specific',
    icon: 'activity',
    tags: ['medical', 'health', 'patient', 'diagnosis', 'icd', 'medication', 'hipaa'],
    exampleInput: 'Patient discharge summary',
    exampleOutput: '{"patient": "...", "diagnoses": [...], "medications": [...]}',
  },
  contract_analysis: {
    id: 'contract_analysis',
    name: 'Contract Analysis',
    description: 'Extract clauses, key terms, obligations, deadlines, and party information',
    category: 'industry_specific',
    icon: 'file-text',
    tags: ['contract', 'clause', 'terms', 'obligations', 'legal', 'nda', 'agreement'],
    exampleInput: 'SaaS subscription agreement',
    exampleOutput: '{"parties": [...], "clauses": [...], "termDate": "...", "obligations": [...]}',
  },
  // ─── Media Processing ──────────────────────────────────────────────────────
  video_summarization: {
    id: 'video_summarization',
    name: 'Video Summarization',
    description: 'Generate full video summary with key themes, events, and speaker identification. BDA analyzes visual and audio signals.',
    category: 'media_processing',
    icon: 'video',
    tags: ['video', 'summary', 'scene', 'speaker', 'mp4', 'mov'],
    exampleInput: 'Product demo video (MP4, up to 240 min)',
    exampleOutput: 'Full summary + per-chapter summaries with timestamps',
  },
  video_chapter_extraction: {
    id: 'video_chapter_extraction',
    name: 'Video Chapter Extraction',
    description: 'Split video into meaningful chapters/scenes with timestamps, summaries, and IAB content classification.',
    category: 'media_processing',
    icon: 'film',
    tags: ['video', 'chapter', 'scene', 'timestamp', 'iab', 'segmentation'],
    exampleInput: 'Training webinar recording',
    exampleOutput: 'Chapters with start/end times, summaries, and IAB categories',
  },
  audio_transcription: {
    id: 'audio_transcription',
    name: 'Audio Transcription',
    description: 'Full speech-to-text transcription with speaker labeling (up to 30 speakers), channel separation, and timestamps. Supports 11 languages.',
    category: 'media_processing',
    icon: 'mic',
    tags: ['audio', 'transcript', 'speech', 'speaker', 'wav', 'mp3', 'flac'],
    exampleInput: 'Customer support call recording (WAV/MP3)',
    exampleOutput: 'Timestamped transcript with speaker labels (spk_0, spk_1)',
  },
  audio_summarization: {
    id: 'audio_summarization',
    name: 'Audio Summarization',
    description: 'Generate topic-based summaries of audio content with timestamps. Identifies key themes and segments conversations by topic.',
    category: 'media_processing',
    icon: 'headphones',
    tags: ['audio', 'summary', 'topic', 'meeting', 'podcast'],
    exampleInput: 'Team meeting recording',
    exampleOutput: 'Topic summaries with timestamps and action items',
  },
  content_moderation: {
    id: 'content_moderation',
    name: 'Content Moderation',
    description: 'Detect inappropriate, unsafe, or offensive content in images, video, and audio. Covers 7 categories including violence, explicit content, hate symbols.',
    category: 'media_processing',
    icon: 'shield-alert',
    tags: ['moderation', 'safety', 'nsfw', 'violence', 'explicit', 'compliance'],
    exampleInput: 'User-uploaded image or video',
    exampleOutput: 'Moderation flags with confidence scores per category',
  },

  // ─── Advanced AI ─────────────────────────────────────────────────────────────
  image_separation: {
    id: 'image_separation',
    name: 'Image Separation',
    description: 'Extract embedded images, charts, and figures from documents. Separate visual elements from text for independent OCR and analysis.',
    category: 'advanced_ai',
    icon: 'image-off',
    tags: ['image', 'extract', 'separate', 'figure', 'chart', 'embedded', 'ocr'],
    exampleInput: 'PDF with embedded product photos and charts',
    exampleOutput: 'Individual images extracted with captions and page locations',
  },
  embedding_generation: {
    id: 'embedding_generation',
    name: 'Embedding Generation',
    description: 'Generate multimodal vector embeddings for text, images, documents, video, and audio using Nova Multimodal Embeddings. Enables semantic search and RAG.',
    category: 'advanced_ai',
    icon: 'database',
    tags: ['embedding', 'vector', 'semantic', 'search', 'rag', 'multimodal', 'similarity'],
    exampleInput: 'Document pages, images, or text passages',
    exampleOutput: 'Vector embeddings (256-3072 dimensions) for indexing in vector stores',
  },
  knowledge_base_ingestion: {
    id: 'knowledge_base_ingestion',
    name: 'Knowledge Base Ingestion',
    description: 'Ingest processed documents into Amazon Bedrock Knowledge Base for retrieval-augmented generation. Final pipeline step that enables AI-powered Q&A over your document corpus.',
    category: 'advanced_ai',
    icon: 'library',
    tags: ['knowledge', 'base', 'rag', 'ingestion', 'bedrock', 'retrieval', 'qa'],
    exampleInput: 'Extracted text + embeddings from processing pipeline',
    exampleOutput: 'Documents indexed in Bedrock Knowledge Base, queryable via RetrieveAndGenerate API',
  },
  pdf_conversion: {
    id: 'pdf_conversion',
    name: 'PDF Conversion',
    description: 'Convert Word, Excel, PowerPoint, images, and other formats to standardized PDF for downstream processing. Uses Python (reportlab, pdfkit) or LibreOffice headless for high-fidelity conversion.',
    category: 'document_conversion',
    icon: 'file',
    tags: ['pdf', 'convert', 'word', 'excel', 'pptx', 'python', 'libreoffice'],
    exampleInput: 'invoice.docx, report.xlsx, presentation.pptx',
    exampleOutput: 'Standardized PDF files ready for text/table extraction',
  },
  format_standardization: {
    id: 'format_standardization',
    name: 'Format Standardization',
    description: 'Normalize document layouts, page sizes, and orientations. Detect and correct rotation, split multi-document PDFs, and standardize to consistent A4/Letter format for reliable extraction.',
    category: 'document_conversion',
    icon: 'settings',
    tags: ['normalize', 'standardize', 'rotate', 'split', 'a4', 'format'],
    exampleInput: 'Mixed-orientation scanned PDF with varying page sizes',
    exampleOutput: 'Uniform A4 PDF with consistent orientation and page numbering',
  },
  ocr_enhancement: {
    id: 'ocr_enhancement',
    name: 'OCR Enhancement',
    description: 'Pre-process images for better OCR accuracy: deskew, denoise, contrast enhancement, and binarization. Combines Amazon Textract with image preprocessing (OpenCV/Pillow) for improved extraction from low-quality scans.',
    category: 'document_conversion',
    icon: 'search',
    tags: ['ocr', 'enhance', 'deskew', 'denoise', 'scan', 'preprocess', 'opencv'],
    exampleInput: 'Low-quality scan with noise, skew, and poor contrast',
    exampleOutput: 'Enhanced image with improved OCR accuracy (90%+ character recognition)',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getCapabilitiesByCategory(
  category: CapabilityCategory,
): CapabilityInfo[] {
  return Object.values(CAPABILITY_INFO).filter((c) => c.category === category);
}

export function searchCapabilities(query: string): CapabilityInfo[] {
  const q = query.toLowerCase();
  return Object.values(CAPABILITY_INFO).filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.tags.some((t) => t.includes(q)),
  );
}
