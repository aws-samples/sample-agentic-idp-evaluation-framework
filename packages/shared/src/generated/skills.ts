/**
 * Auto-generated from skill definition files.
 * Do not edit manually - run: npx tsx scripts/build-skills.ts
 */

// Skill IDs (capabilities)
export const SKILL_IDS = [
  'entity_extraction',
  'handwriting_extraction',
  'kv_extraction',
  'table_extraction',
  'text_extraction',
  'barcode_qr',
  'bounding_box',
  'image_description',
  'layout_analysis',
  'signature_detection',
  'document_classification',
  'document_splitting',
  'document_summarization',
  'language_detection',
  'pii_detection',
  'pii_redaction',
  'check_processing',
  'contract_analysis',
  'insurance_claims',
  'invoice_processing',
  'medical_records',
  'receipt_parsing',
  'audio_summarization',
  'audio_transcription',
  'content_moderation',
  'video_chapter_extraction',
  'video_summarization',
  'embedding_generation',
  'image_separation',
  'knowledge_base_ingestion',
  'format_standardization',
  'ocr_enhancement',
  'pdf_conversion',
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

// Skill info generated from .md frontmatter
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  defaultFormat: string;
  tags: string[];
  exampleInput: string;
  exampleOutput: string;
  support: Record<string, string>;
}

export const SKILL_INFO: Record<SkillId, SkillInfo> = {
  'entity_extraction': {
    id: 'entity_extraction',
    name: 'Named Entity Extraction',
    description: 'Extract names, dates, monetary amounts, addresses, phone numbers, and emails',
    category: 'core_extraction',
    icon: 'user',
    defaultFormat: 'json',
    tags: ['ner', 'names', 'dates', 'amounts', 'addresses', 'phone', 'email'],
    exampleInput: 'Business letter or contract',
    exampleOutput: '{"persons": [...], "dates": [...], "amounts": [...], "addresses": [...]}',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'handwriting_extraction': {
    id: 'handwriting_extraction',
    name: 'Handwriting Recognition',
    description: 'Recognize and extract handwritten text, notes, and annotations',
    category: 'core_extraction',
    icon: 'edit',
    defaultFormat: 'text',
    tags: ['handwriting', 'cursive', 'annotations', 'notes'],
    exampleInput: 'Handwritten medical form',
    exampleOutput: 'Digitized text from handwritten fields',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'excellent' as const
    },
  },
  'kv_extraction': {
    id: 'kv_extraction',
    name: 'Key-Value Pair Extraction',
    description: 'Extract structured key-value pairs from forms, labels, and field-based documents',
    category: 'core_extraction',
    icon: 'list',
    defaultFormat: 'json',
    tags: ['form', 'fields', 'key-value', 'structured', 'labels'],
    exampleInput: 'Tax form W-2',
    exampleOutput: '{"employer_name": "...", "wages": "$...", "ssn": "***-**-****"}',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'excellent' as const
    },
  },
  'table_extraction': {
    id: 'table_extraction',
    name: 'Table Extraction',
    description: 'Extract tables including nested, merged cells, and complex layouts to HTML or CSV',
    category: 'core_extraction',
    icon: 'table',
    defaultFormat: 'html',
    tags: ['table', 'nested', 'merged', 'html', 'csv', 'structured'],
    exampleInput: 'Financial statement with nested tables',
    exampleOutput: 'HTML/CSV with preserved structure',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'excellent' as const
    },
  },
  'text_extraction': {
    id: 'text_extraction',
    name: 'Text Extraction',
    description: 'Extract printed text from any document with layout preservation',
    category: 'core_extraction',
    icon: 'file-text',
    defaultFormat: 'text',
    tags: ['text', 'ocr', 'printed', 'digital'],
    exampleInput: 'Scanned contract PDF',
    exampleOutput: 'Full text with paragraph structure',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'excellent' as const
    },
  },
  'barcode_qr': {
    id: 'barcode_qr',
    name: 'Barcode & QR Code',
    description: 'Detect and decode barcodes, QR codes, and data matrix codes',
    category: 'visual_analysis',
    icon: 'maximize',
    defaultFormat: 'json',
    tags: ['barcode', 'qr', 'data-matrix', 'scan', 'code'],
    exampleInput: 'Shipping label with barcode',
    exampleOutput: '{"type": "QR", "data": "https://...", "location": {...}}',
    support: {
    'bda': 'limited' as const,
    'bda-llm': 'limited' as const,
    'claude': 'limited' as const,
    'nova': 'good' as const
    },
  },
  'bounding_box': {
    id: 'bounding_box',
    name: 'Bounding Box Detection',
    description: 'Detect and locate elements with precise spatial coordinates (x, y, width, height)',
    category: 'visual_analysis',
    icon: 'crop',
    defaultFormat: 'json',
    tags: ['bbox', 'coordinates', 'spatial', 'detection', 'region'],
    exampleInput: 'Yearbook page with photos',
    exampleOutput: '[{"label": "face", "x": 120, "y": 45, "w": 80, "h": 100}]',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'limited' as const,
    'nova': 'excellent' as const,
    'textract-llm': 'good' as const
    },
  },
  'image_description': {
    id: 'image_description',
    name: 'Image & Chart Analysis',
    description: 'Describe and interpret images, charts, graphs, and diagrams within documents',
    category: 'visual_analysis',
    icon: 'image',
    defaultFormat: 'json',
    tags: ['image', 'chart', 'graph', 'diagram', 'photo', 'visual'],
    exampleInput: 'Annual report with pie charts',
    exampleOutput: 'Detailed description of each chart with data points',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'good' as const,
    'claude': 'excellent' as const,
    'nova': 'excellent' as const
    },
  },
  'layout_analysis': {
    id: 'layout_analysis',
    name: 'Layout Analysis',
    description: 'Detect reading order, columns, sections, headers, footers, and page structure',
    category: 'visual_analysis',
    icon: 'layout',
    defaultFormat: 'json',
    tags: ['layout', 'columns', 'sections', 'headers', 'footers', 'reading-order'],
    exampleInput: 'Multi-column newspaper article',
    exampleOutput: '{"sections": [...], "readingOrder": [...], "columns": 2}',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'good' as const,
    'nova': 'excellent' as const,
    'textract-llm': 'excellent' as const
    },
  },
  'signature_detection': {
    id: 'signature_detection',
    name: 'Signature Detection',
    description: 'Detect presence and location of signatures, initials, and stamps',
    category: 'visual_analysis',
    icon: 'pen-tool',
    defaultFormat: 'json',
    tags: ['signature', 'initials', 'stamp', 'signed', 'notarized'],
    exampleInput: 'Signed contract',
    exampleOutput: '{"hasSignature": true, "locations": [...], "count": 2}',
    support: {
    'bda': 'limited' as const,
    'bda-llm': 'good' as const,
    'claude': 'good' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'document_classification': {
    id: 'document_classification',
    name: 'Document Classification',
    description: 'Automatically classify document type (invoice, contract, form, letter, etc.)',
    category: 'document_intelligence',
    icon: 'folder',
    defaultFormat: 'json',
    tags: ['classify', 'categorize', 'type', 'identification'],
    exampleInput: 'Unknown document',
    exampleOutput: '{"type": "invoice", "confidence": 0.95, "subtype": "utility_bill"}',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'document_splitting': {
    id: 'document_splitting',
    name: 'Document Splitting',
    description: 'Split multi-document PDFs into logical documents with page-level classification',
    category: 'document_intelligence',
    icon: 'scissors',
    defaultFormat: 'json',
    tags: ['split', 'multi-document', 'page-classification', 'boundaries'],
    exampleInput: '50-page PDF with mixed documents',
    exampleOutput: '[{"pages": [1,2], "type": "invoice"}, {"pages": [3,4,5], "type": "contract"}]',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'good' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'document_summarization': {
    id: 'document_summarization',
    name: 'Document Summarization',
    description: 'Generate executive summaries, key points, and section-by-section analysis',
    category: 'document_intelligence',
    icon: 'align-left',
    defaultFormat: 'text',
    tags: ['summary', 'key-points', 'abstract', 'executive-summary'],
    exampleInput: '20-page legal agreement',
    exampleOutput: 'Executive summary with key terms, obligations, and deadlines',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'language_detection': {
    id: 'language_detection',
    name: 'Language Detection',
    description: 'Auto-detect document language and optionally translate content',
    category: 'document_intelligence',
    icon: 'globe',
    defaultFormat: 'json',
    tags: ['language', 'detect', 'translate', 'multilingual', 'i18n'],
    exampleInput: 'Document in unknown language',
    exampleOutput: '{"language": "ko", "confidence": 0.98, "name": "Korean"}',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'pii_detection': {
    id: 'pii_detection',
    name: 'PII Detection',
    description: 'Detect personally identifiable information: SSN, credit cards, bank accounts, etc.',
    category: 'compliance_security',
    icon: 'shield',
    defaultFormat: 'json',
    tags: ['pii', 'ssn', 'credit-card', 'bank-account', 'privacy', 'gdpr'],
    exampleInput: 'Customer application form',
    exampleOutput: '[{"type": "SSN", "value": "***-**-1234", "location": {...}}]',
    support: {
    'bda': 'limited' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'pii_redaction': {
    id: 'pii_redaction',
    name: 'PII Redaction',
    description: 'Automatically redact PII from extracted text and generate sanitized output',
    category: 'compliance_security',
    icon: 'eye-off',
    defaultFormat: 'json',
    tags: ['redact', 'sanitize', 'mask', 'anonymize', 'privacy'],
    exampleInput: 'Document with SSNs and addresses',
    exampleOutput: 'Same document with PII replaced by [REDACTED]',
    support: {
    'bda-llm': 'good' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'check_processing': {
    id: 'check_processing',
    name: 'Check Processing',
    description: 'Extract courtesy/legal amounts, payee, date, memo, and MICR line from checks',
    category: 'industry_specific',
    icon: 'credit-card',
    defaultFormat: 'json',
    tags: ['check', 'cheque', 'amount', 'payee', 'micr', 'banking'],
    exampleInput: 'Personal check image',
    exampleOutput: '{"courtesyAmount": "$500.00", "legalAmount": "Five hundred...", "payee": "..."}',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'excellent' as const
    },
  },
  'contract_analysis': {
    id: 'contract_analysis',
    name: 'Contract Analysis',
    description: 'Extract clauses, key terms, obligations, deadlines, and party information',
    category: 'industry_specific',
    icon: 'file-text',
    defaultFormat: 'json',
    tags: ['contract', 'clause', 'terms', 'obligations', 'legal', 'nda', 'agreement'],
    exampleInput: 'SaaS subscription agreement',
    exampleOutput: '{"parties": [...], "clauses": [...], "termDate": "...", "obligations": [...]}',
    support: {
    'bda': 'limited' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'insurance_claims': {
    id: 'insurance_claims',
    name: 'Insurance Claims',
    description: 'Extract claim details, policy info, damage assessment, and coverage information',
    category: 'industry_specific',
    icon: 'shield',
    defaultFormat: 'json',
    tags: ['insurance', 'claim', 'policy', 'coverage', 'damage', 'assessment'],
    exampleInput: 'Auto insurance claim form',
    exampleOutput: '{"claimId": "...", "policyNumber": "...", "damages": [...], "amount": "$..."}',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'invoice_processing': {
    id: 'invoice_processing',
    name: 'Invoice Processing',
    description: 'Extract line items, totals, taxes, discounts, vendor/buyer info from invoices',
    category: 'industry_specific',
    icon: 'file-text',
    defaultFormat: 'json',
    tags: ['invoice', 'line-items', 'totals', 'vendor', 'ap', 'accounts-payable'],
    exampleInput: 'Vendor invoice PDF',
    exampleOutput: '{"vendor": "...", "lineItems": [...], "total": "$1,234.56", "tax": "$98.76"}',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'excellent' as const
    },
  },
  'medical_records': {
    id: 'medical_records',
    name: 'Medical Records',
    description: 'Extract patient info, diagnoses (ICD codes), medications, and treatment plans',
    category: 'industry_specific',
    icon: 'activity',
    defaultFormat: 'json',
    tags: ['medical', 'health', 'patient', 'diagnosis', 'icd', 'medication', 'hipaa'],
    exampleInput: 'Patient discharge summary',
    exampleOutput: '{"patient": "...", "diagnoses": [...], "medications": [...]}',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'good' as const
    },
  },
  'receipt_parsing': {
    id: 'receipt_parsing',
    name: 'Receipt Parsing',
    description: 'Parse receipts for items, prices, totals, store info, and payment details',
    category: 'industry_specific',
    icon: 'shopping-cart',
    defaultFormat: 'json',
    tags: ['receipt', 'items', 'prices', 'store', 'expense', 'reimbursement'],
    exampleInput: 'Restaurant receipt photo',
    exampleOutput: '{"store": "...", "items": [...], "subtotal": "$45.00", "tip": "$9.00"}',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'excellent' as const,
    'nova': 'good' as const,
    'textract-llm': 'excellent' as const
    },
  },
  'audio_summarization': {
    id: 'audio_summarization',
    name: 'Audio Summarization',
    description: 'Generate topic-based summaries of audio content with timestamps. Identifies key themes and segments conversations by topic.',
    category: 'media_processing',
    icon: 'headphones',
    defaultFormat: 'json',
    tags: ['audio', 'summary', 'topic', 'meeting', 'podcast'],
    exampleInput: 'Team meeting recording',
    exampleOutput: 'Topic summaries with timestamps and action items',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'good' as const,
    'nova': 'good' as const
    },
  },
  'audio_transcription': {
    id: 'audio_transcription',
    name: 'Audio Transcription',
    description: 'Full speech-to-text transcription with speaker labeling (up to 30 speakers), channel separation, and timestamps. Supports 11 languages.',
    category: 'media_processing',
    icon: 'mic',
    defaultFormat: 'json',
    tags: ['audio', 'transcript', 'speech', 'speaker', 'wav', 'mp3', 'flac'],
    exampleInput: 'Customer support call recording (WAV/MP3)',
    exampleOutput: 'Timestamped transcript with speaker labels (spk_0, spk_1)',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'good' as const,
    'nova': 'good' as const
    },
  },
  'content_moderation': {
    id: 'content_moderation',
    name: 'Content Moderation',
    description: 'Detect inappropriate, unsafe, or offensive content in images, video, and audio. Covers 7 categories including violence, explicit content, hate symbols.',
    category: 'media_processing',
    icon: 'shield-alert',
    defaultFormat: 'json',
    tags: ['moderation', 'safety', 'nsfw', 'violence', 'explicit', 'compliance'],
    exampleInput: 'User-uploaded image or video',
    exampleOutput: 'Moderation flags with confidence scores per category',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'good' as const,
    'nova': 'good' as const
    },
  },
  'video_chapter_extraction': {
    id: 'video_chapter_extraction',
    name: 'Video Chapter Extraction',
    description: 'Split video into meaningful chapters/scenes with timestamps, summaries, and IAB content classification.',
    category: 'media_processing',
    icon: 'film',
    defaultFormat: 'json',
    tags: ['video', 'chapter', 'scene', 'timestamp', 'iab', 'segmentation'],
    exampleInput: 'Training webinar recording',
    exampleOutput: 'Chapters with start/end times, summaries, and IAB categories',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'good' as const,
    'nova': 'good' as const
    },
  },
  'video_summarization': {
    id: 'video_summarization',
    name: 'Video Summarization',
    description: 'Generate full video summary with key themes, events, and speaker identification. BDA analyzes visual and audio signals.',
    category: 'media_processing',
    icon: 'video',
    defaultFormat: 'json',
    tags: ['video', 'summary', 'scene', 'speaker', 'mp4', 'mov'],
    exampleInput: 'Product demo video (MP4, up to 240 min)',
    exampleOutput: 'Full summary + per-chapter summaries with timestamps',
    support: {
    'bda': 'excellent' as const,
    'bda-llm': 'excellent' as const,
    'claude': 'good' as const,
    'nova': 'good' as const
    },
  },
  'embedding_generation': {
    id: 'embedding_generation',
    name: 'Embedding Generation',
    description: 'Generate multimodal vector embeddings for text, images, documents, video, and audio using Nova Multimodal Embeddings. Enables semantic search and RAG.',
    category: 'advanced_ai',
    icon: 'database',
    defaultFormat: 'json',
    tags: ['embedding', 'vector', 'semantic', 'search', 'rag', 'multimodal', 'similarity'],
    exampleInput: 'Document pages, images, or text passages',
    exampleOutput: 'Vector embeddings (256-3072 dimensions) for indexing in vector stores',
    support: {
    'embeddings': 'excellent' as const
    },
  },
  'image_separation': {
    id: 'image_separation',
    name: 'Image Separation',
    description: 'Extract embedded images, charts, and figures from documents. Separate visual elements from text for independent OCR and analysis.',
    category: 'advanced_ai',
    icon: 'image-off',
    defaultFormat: 'json',
    tags: ['image', 'extract', 'separate', 'figure', 'chart', 'embedded', 'ocr'],
    exampleInput: 'PDF with embedded product photos and charts',
    exampleOutput: 'Individual images extracted with captions and page locations',
    support: {
    'bda': 'good' as const,
    'bda-llm': 'good' as const,
    'claude': 'good' as const,
    'nova': 'good' as const
    },
  },
  'knowledge_base_ingestion': {
    id: 'knowledge_base_ingestion',
    name: 'Knowledge Base Ingestion',
    description: 'Ingest processed documents into Amazon Bedrock Knowledge Base for retrieval-augmented generation. Final pipeline step that enables AI-powered Q&A over your document corpus.',
    category: 'advanced_ai',
    icon: 'library',
    defaultFormat: 'json',
    tags: ['knowledge', 'base', 'rag', 'ingestion', 'bedrock', 'retrieval', 'qa'],
    exampleInput: 'Extracted text + embeddings from processing pipeline',
    exampleOutput: 'Documents indexed in Bedrock Knowledge Base, queryable via RetrieveAndGenerate API',
    support: {
    'embeddings': 'good' as const
    },
  },
  'format_standardization': {
    id: 'format_standardization',
    name: 'Format Standardization',
    description: 'Normalize page sizes, orientations, and layouts. Detect and correct rotation, split multi-document PDFs, standardize to A4/Letter. Method Support: Lambda + PyMuPDF/pikepdf for lightweight ops, or Amazon Textract AnalyzeDocument for layout detection + Lambda for correction.',
    category: 'document_conversion',
    icon: 'ruler',
    defaultFormat: 'json',
    tags: ['normalize', 'standardize', 'rotate', 'split', 'a4', 'pymupdf', 'pikepdf'],
    exampleInput: 'Mixed-orientation scanned PDF with varying page sizes',
    exampleOutput: 'Uniform A4 PDF with consistent orientation and page numbering',
    support: {

    },
  },
  'ocr_enhancement': {
    id: 'ocr_enhancement',
    name: 'OCR Enhancement',
    description: 'Pre-process scanned images for better extraction accuracy: deskew, denoise, contrast enhancement, binarization. Method Support: Lambda + OpenCV/Pillow for image preprocessing, then Amazon Textract for OCR, or BDA with overrideConfiguration for enhanced extraction. Critical for low-quality fax/scan inputs.',
    category: 'document_conversion',
    icon: 'scan-eye',
    defaultFormat: 'json',
    tags: ['ocr', 'enhance', 'deskew', 'denoise', 'scan', 'opencv', 'textract', 'preprocess'],
    exampleInput: 'Low-quality scan with noise, skew, and poor contrast',
    exampleOutput: 'Enhanced image with improved OCR accuracy (90%+ character recognition)',
    support: {
    'textract-llm': 'limited' as const
    },
  },
  'pdf_conversion': {
    id: 'pdf_conversion',
    name: 'PDF Conversion',
    description: 'Convert Word, Excel, PowerPoint, images, and other formats to standardized PDF. Method Support: Lambda + LibreOffice headless (serverless), or Step Functions + ECS Fargate for batch. Not a model-based capability — runs as a preprocessing step before BDA/LLM extraction.',
    category: 'document_conversion',
    icon: 'file-output',
    defaultFormat: 'json',
    tags: ['pdf', 'convert', 'word', 'excel', 'pptx', 'lambda', 'libreoffice'],
    exampleInput: 'invoice.docx, report.xlsx, presentation.pptx',
    exampleOutput: 'Standardized PDF files ready for BDA or LLM extraction',
    support: {

    },
  },
};

// Re-export as capability aliases for backward compatibility
export const GENERATED_CAPABILITIES = SKILL_IDS;
export const GENERATED_CAPABILITY_INFO = SKILL_INFO;
