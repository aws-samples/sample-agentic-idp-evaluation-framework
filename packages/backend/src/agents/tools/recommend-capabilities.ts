import type { Capability, CapabilityRecommendation } from '@idp/shared';
import type { DocumentAnalysis } from './analyze-document.js';

export function recommendCapabilities(
  analysis: DocumentAnalysis,
  userRequirements: string[],
): CapabilityRecommendation[] {
  const recommendations: CapabilityRecommendation[] = [];
  const reqText = userRequirements.join(' ').toLowerCase();

  // Text extraction is almost always relevant
  recommendations.push({
    capability: 'text_extraction' as Capability,
    relevance: 0.9,
    rationale: 'Free-form text extraction is fundamental for most document processing workflows.',
  });

  // Handwriting extraction
  if (reqText.includes('handwriting') || reqText.includes('handwritten') || reqText.includes('cursive')) {
    recommendations.push({
      capability: 'handwriting_extraction' as Capability,
      relevance: 0.85,
      rationale: 'Handwriting extraction will recognize cursive text, notes, and annotations.',
    });
  }

  // Table extraction
  if (analysis.hasTablesDetected || reqText.includes('table')) {
    recommendations.push({
      capability: 'table_extraction' as Capability,
      relevance: analysis.hasTablesDetected ? 0.95 : 0.6,
      rationale: analysis.hasTablesDetected
        ? 'Tables detected in the document. Table extraction will preserve structure.'
        : 'Table extraction requested based on your requirements.',
    });
  }

  // Key-value extraction
  if (analysis.hasFormsDetected || reqText.match(/form|key|field|label/)) {
    recommendations.push({
      capability: 'kv_extraction' as Capability,
      relevance: analysis.hasFormsDetected ? 0.9 : 0.7,
      rationale: analysis.hasFormsDetected
        ? 'Form fields detected. Key-value extraction will capture structured data.'
        : 'Key-value extraction can help extract structured fields from your documents.',
    });
  }

  // Entity extraction
  if (reqText.match(/name|date|amount|address|phone|email|entity/)) {
    recommendations.push({
      capability: 'entity_extraction' as Capability,
      relevance: 0.75,
      rationale: 'Entity extraction will identify names, dates, amounts, addresses, and contact information.',
    });
  }

  // Image description
  if (analysis.hasImagesDetected || reqText.match(/image|chart|graph|diagram|photo/)) {
    recommendations.push({
      capability: 'image_description' as Capability,
      relevance: analysis.hasImagesDetected ? 0.85 : 0.5,
      rationale: analysis.hasImagesDetected
        ? 'Images/charts detected. Image description will provide textual analysis.'
        : 'Image description can analyze visual elements in your documents.',
    });
  }

  // Bounding box
  if (reqText.match(/location|position|coordinate|bounding|spatial/)) {
    recommendations.push({
      capability: 'bounding_box' as Capability,
      relevance: 0.8,
      rationale: 'Bounding box detection will provide spatial coordinates for document elements.',
    });
  }

  // Signature detection
  if (reqText.match(/signature|signed|initial|stamp/)) {
    recommendations.push({
      capability: 'signature_detection' as Capability,
      relevance: 0.85,
      rationale: 'Signature detection will locate and verify signatures, initials, and stamps.',
    });
  }

  // Barcode/QR
  if (reqText.match(/barcode|qr|code|scan/)) {
    recommendations.push({
      capability: 'barcode_qr' as Capability,
      relevance: 0.9,
      rationale: 'Barcode and QR code detection will decode embedded codes.',
    });
  }

  // Layout analysis
  if (reqText.match(/layout|column|section|reading.*order|structure/)) {
    recommendations.push({
      capability: 'layout_analysis' as Capability,
      relevance: 0.75,
      rationale: 'Layout analysis will detect document structure, columns, and reading order.',
    });
  }

  // Document classification
  if (reqText.match(/classify|classification|type|category/)) {
    recommendations.push({
      capability: 'document_classification' as Capability,
      relevance: 0.8,
      rationale: 'Document classification will automatically determine document type.',
    });
  }

  // Document splitting
  if (reqText.match(/split|multi.*document|separate|divide/) || analysis.pageCount > 10) {
    recommendations.push({
      capability: 'document_splitting' as Capability,
      relevance: analysis.pageCount > 10 ? 0.7 : 0.6,
      rationale: 'Document splitting can separate multi-document files into logical units.',
    });
  }

  // Document summarization
  if (reqText.match(/summar|abstract|key.*point|executive/) || analysis.pageCount > 5) {
    recommendations.push({
      capability: 'document_summarization' as Capability,
      relevance: analysis.pageCount > 5 ? 0.75 : 0.6,
      rationale: 'Document summarization will generate executive summaries and key points.',
    });
  }

  // Language detection
  if (reqText.match(/language|translate|multilingual|foreign/)) {
    recommendations.push({
      capability: 'language_detection' as Capability,
      relevance: 0.8,
      rationale: 'Language detection will identify the document language.',
    });
  }

  // PII detection
  if (reqText.match(/pii|privacy|ssn|credit.*card|gdpr|hipaa|sensitive/)) {
    recommendations.push({
      capability: 'pii_detection' as Capability,
      relevance: 0.9,
      rationale: 'PII detection will identify sensitive personal information.',
    });
  }

  // PII redaction
  if (reqText.match(/redact|mask|anonymize|sanitize/)) {
    recommendations.push({
      capability: 'pii_redaction' as Capability,
      relevance: 0.9,
      rationale: 'PII redaction will automatically remove sensitive information.',
    });
  }

  // Invoice processing
  if (reqText.match(/invoice|bill|vendor|line.*item|ap|accounts.*payable/)) {
    recommendations.push({
      capability: 'invoice_processing' as Capability,
      relevance: 0.95,
      rationale: 'Invoice processing will extract line items, totals, taxes, and vendor information.',
    });
  }

  // Receipt parsing
  if (reqText.match(/receipt|expense|reimbursement|restaurant|store/)) {
    recommendations.push({
      capability: 'receipt_parsing' as Capability,
      relevance: 0.95,
      rationale: 'Receipt parsing will extract items, prices, totals, and store information.',
    });
  }

  // Check processing
  if (reqText.match(/check|cheque|banking|micr|payee/)) {
    recommendations.push({
      capability: 'check_processing' as Capability,
      relevance: 0.95,
      rationale: 'Check processing will extract amounts, payee, date, and MICR line information.',
    });
  }

  // Insurance claims
  if (reqText.match(/insurance|claim|policy|coverage|damage/)) {
    recommendations.push({
      capability: 'insurance_claims' as Capability,
      relevance: 0.9,
      rationale: 'Insurance claims processing will extract policy details and damage assessments.',
    });
  }

  // Medical records
  if (reqText.match(/medical|health|patient|diagnosis|medication|icd|hipaa/)) {
    recommendations.push({
      capability: 'medical_records' as Capability,
      relevance: 0.9,
      rationale: 'Medical records processing will extract patient info, diagnoses, and medications.',
    });
  }

  // Contract analysis
  if (reqText.match(/contract|clause|legal|agreement|nda|terms|obligation/)) {
    recommendations.push({
      capability: 'contract_analysis' as Capability,
      relevance: 0.9,
      rationale: 'Contract analysis will extract clauses, terms, obligations, and party information.',
    });
  }

  // Sort by relevance descending
  recommendations.sort((a, b) => b.relevance - a.relevance);

  return recommendations;
}
