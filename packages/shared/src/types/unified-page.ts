/**
 * Uniform page-image+text representation (#4)
 * Each page = text + structured extractions, normalized across all adapter outputs.
 */

export interface ExtractedTable {
  rows: string[][];
  confidence: number;
  caption?: string;
}

export interface ExtractedKVPair {
  key: string;
  value: string;
  confidence: number;
}

export interface ExtractedEntity {
  type: string;
  value: string;
  confidence: number;
}

export interface UnifiedPageResult {
  pageNumber: number;
  text: string;
  tables: ExtractedTable[];
  kvPairs: ExtractedKVPair[];
  entities: ExtractedEntity[];
  metadata: Record<string, unknown>;
}

export interface UnifiedDocumentResult {
  documentId: string;
  method: string;
  pages: UnifiedPageResult[];
  totalPages: number;
  processingTimeMs: number;
}
