/**
 * JSON Schema-based document classes (#5)
 * Replaces hardcoded industry-specific capabilities with schema-driven extraction.
 */

export interface DocumentFieldSchema {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  examples?: string[];
}

export interface DocumentClassSchema {
  id: string;
  name: string;
  description: string;
  category: string;
  fields: DocumentFieldSchema[];
  extractionPrompt: string;
}

export const DOCUMENT_SCHEMAS: DocumentClassSchema[] = [
  {
    id: 'invoice',
    name: 'Invoice',
    description: 'Commercial invoices, bills, purchase orders',
    category: 'financial',
    fields: [
      { name: 'vendor_name', type: 'string', description: 'Name of the vendor/seller', required: true },
      { name: 'vendor_address', type: 'string', description: 'Address of the vendor' },
      { name: 'buyer_name', type: 'string', description: 'Name of the buyer/customer', required: true },
      { name: 'buyer_address', type: 'string', description: 'Address of the buyer' },
      { name: 'invoice_number', type: 'string', description: 'Unique invoice identifier', required: true },
      { name: 'invoice_date', type: 'date', description: 'Date the invoice was issued', required: true },
      { name: 'due_date', type: 'date', description: 'Payment due date' },
      { name: 'line_items', type: 'array', description: 'List of items/services with description, quantity, unit price, amount', required: true },
      { name: 'subtotal', type: 'number', description: 'Sum before taxes', required: true },
      { name: 'tax_amount', type: 'number', description: 'Tax amount' },
      { name: 'total_amount', type: 'number', description: 'Total amount due', required: true },
      { name: 'currency', type: 'string', description: 'Currency code (USD, EUR, etc.)', examples: ['USD', 'EUR', 'KRW'] },
      { name: 'payment_terms', type: 'string', description: 'Payment terms (Net 30, etc.)' },
      { name: 'po_number', type: 'string', description: 'Purchase order number' },
    ],
    extractionPrompt: 'Extract all invoice fields including vendor/buyer details, line items with quantities and prices, subtotal, tax, and total amount.',
  },
  {
    id: 'receipt',
    name: 'Receipt',
    description: 'Purchase receipts, transaction records',
    category: 'financial',
    fields: [
      { name: 'store_name', type: 'string', description: 'Name of the store/merchant', required: true },
      { name: 'store_address', type: 'string', description: 'Address of the store' },
      { name: 'store_phone', type: 'string', description: 'Phone number of the store' },
      { name: 'transaction_date', type: 'date', description: 'Date of transaction', required: true },
      { name: 'transaction_time', type: 'string', description: 'Time of transaction' },
      { name: 'items', type: 'array', description: 'List of purchased items with name, quantity, price', required: true },
      { name: 'subtotal', type: 'number', description: 'Sum before tax' },
      { name: 'tax', type: 'number', description: 'Tax amount' },
      { name: 'total', type: 'number', description: 'Total amount paid', required: true },
      { name: 'payment_method', type: 'string', description: 'Cash, Credit Card, etc.', examples: ['Cash', 'Credit Card', 'Debit Card'] },
      { name: 'card_last_four', type: 'string', description: 'Last 4 digits of card number' },
    ],
    extractionPrompt: 'Extract all receipt fields including store info, items purchased with prices, totals, tax, and payment method.',
  },
  {
    id: 'generic',
    name: 'Generic Document',
    description: 'Any document type — extracts common fields',
    category: 'general',
    fields: [
      { name: 'document_type', type: 'string', description: 'Detected document type', required: true },
      { name: 'title', type: 'string', description: 'Document title or heading' },
      { name: 'date', type: 'date', description: 'Primary date on the document' },
      { name: 'author', type: 'string', description: 'Author or creator' },
      { name: 'organization', type: 'string', description: 'Organization name' },
      { name: 'summary', type: 'string', description: 'Brief summary of document content', required: true },
      { name: 'key_entities', type: 'array', description: 'Important names, dates, amounts found' },
      { name: 'language', type: 'string', description: 'Document language', required: true },
      { name: 'page_count', type: 'number', description: 'Number of pages' },
    ],
    extractionPrompt: 'Extract the document type, title, key dates, organizations, a brief summary, and any important entities found.',
  },
  {
    id: 'insurance_claim',
    name: 'Insurance Claim',
    description: 'Insurance claim forms, damage reports',
    category: 'insurance',
    fields: [
      { name: 'claim_number', type: 'string', description: 'Claim reference number', required: true },
      { name: 'policy_number', type: 'string', description: 'Insurance policy number', required: true },
      { name: 'claimant_name', type: 'string', description: 'Name of the claimant', required: true },
      { name: 'incident_date', type: 'date', description: 'Date of the incident', required: true },
      { name: 'incident_type', type: 'string', description: 'Type of claim (auto, health, property, etc.)', required: true },
      { name: 'incident_description', type: 'string', description: 'Description of the incident' },
      { name: 'damage_amount', type: 'number', description: 'Estimated damage or claim amount' },
      { name: 'coverage_type', type: 'string', description: 'Type of coverage' },
      { name: 'adjuster_name', type: 'string', description: 'Claims adjuster name' },
      { name: 'status', type: 'string', description: 'Claim status', examples: ['Open', 'Under Review', 'Approved', 'Denied'] },
    ],
    extractionPrompt: 'Extract claim number, policy number, claimant details, incident information, damage amounts, and claim status.',
  },
  {
    id: 'medical_record',
    name: 'Medical Record',
    description: 'Patient records, clinical notes, lab results',
    category: 'healthcare',
    fields: [
      { name: 'patient_name', type: 'string', description: 'Patient full name', required: true },
      { name: 'patient_dob', type: 'date', description: 'Patient date of birth' },
      { name: 'patient_id', type: 'string', description: 'Patient/MRN identifier' },
      { name: 'visit_date', type: 'date', description: 'Date of visit/service', required: true },
      { name: 'provider_name', type: 'string', description: 'Physician/provider name' },
      { name: 'facility', type: 'string', description: 'Hospital or clinic name' },
      { name: 'diagnoses', type: 'array', description: 'ICD codes and diagnosis descriptions', required: true },
      { name: 'medications', type: 'array', description: 'Prescribed medications with dosage' },
      { name: 'procedures', type: 'array', description: 'Procedures performed' },
      { name: 'vitals', type: 'object', description: 'Vital signs (BP, HR, temp, etc.)' },
      { name: 'notes', type: 'string', description: 'Clinical notes or assessment' },
    ],
    extractionPrompt: 'Extract patient information, visit details, diagnoses, medications, procedures, and clinical notes.',
  },
  {
    id: 'contract',
    name: 'Contract / Agreement',
    description: 'Legal contracts, NDAs, service agreements',
    category: 'legal',
    fields: [
      { name: 'contract_type', type: 'string', description: 'Type of contract (NDA, SLA, Employment, etc.)', required: true },
      { name: 'parties', type: 'array', description: 'Names of contracting parties', required: true },
      { name: 'effective_date', type: 'date', description: 'Date the contract takes effect', required: true },
      { name: 'expiration_date', type: 'date', description: 'Date the contract expires' },
      { name: 'key_terms', type: 'array', description: 'Important terms and conditions', required: true },
      { name: 'obligations', type: 'array', description: 'Obligations of each party' },
      { name: 'compensation', type: 'string', description: 'Payment terms or compensation details' },
      { name: 'termination_clause', type: 'string', description: 'Conditions for termination' },
      { name: 'governing_law', type: 'string', description: 'Jurisdiction or governing law' },
      { name: 'signatures', type: 'array', description: 'Signatories and their roles' },
    ],
    extractionPrompt: 'Extract contract type, parties involved, effective and expiration dates, key terms, obligations, compensation, and termination clauses.',
  },
];

/** Get a schema by ID */
export function getDocumentSchema(id: string): DocumentClassSchema | undefined {
  return DOCUMENT_SCHEMAS.find((s) => s.id === id);
}

/** Build an extraction prompt from a schema */
export function buildSchemaExtractionPrompt(schema: DocumentClassSchema): string {
  const fieldList = schema.fields
    .map((f) => `- ${f.name} (${f.type}${f.required ? ', required' : ''}): ${f.description}`)
    .join('\n');

  return `${schema.extractionPrompt}

Extract the following fields as YAML:
${fieldList}

For each field, set the value to null if not found in the document. Include a confidence score (0.0-1.0) for each extracted field.`;
}
