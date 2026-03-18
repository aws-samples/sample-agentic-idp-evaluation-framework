import type { Capability } from './capabilities.js';
import type { ProcessingMethod } from './processing.js';
import type { DocumentType } from './documents.js';

export interface UploadResponse {
  documentId: string;
  s3Uri: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  previewUrl: string;
  documentType?: DocumentType;
}

export interface ConversationRequest {
  documentId: string;
  s3Uri?: string;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}

export interface ProcessRequest {
  documentId: string;
  s3Uri: string;
  capabilities: Capability[];
  methods: ProcessingMethod[];
}

export interface ArchitectureRequest {
  documentId: string;
  processingResults: import('./processing.js').ProcessorResult[];
  comparison: import('./processing.js').ComparisonResult;
  capabilities: Capability[];
}
