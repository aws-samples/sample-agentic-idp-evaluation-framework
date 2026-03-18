export const DOCUMENT_TYPES = [
  'pdf',
  'image',
  'docx',
  'pptx',
  'xlsx',
  'video',
  'audio',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface DocumentTypeInfo {
  id: DocumentType;
  name: string;
  extensions: string[];
  mimeTypes: string[];
  description: string;
  icon: string;
}

export const DOCUMENT_TYPE_INFO: Record<DocumentType, DocumentTypeInfo> = {
  pdf: {
    id: 'pdf',
    name: 'PDF',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    description: 'Portable Document Format - scanned, digital, or mixed',
    icon: 'file-pdf',
  },
  image: {
    id: 'image',
    name: 'Image',
    extensions: ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.gif', '.webp'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/bmp', 'image/gif', 'image/webp'],
    description: 'Photos, scanned pages, screenshots, diagrams',
    icon: 'file-image',
  },
  docx: {
    id: 'docx',
    name: 'Word Document',
    extensions: ['.docx', '.doc'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ],
    description: 'Microsoft Word documents with text, tables, and embedded images',
    icon: 'file-word',
  },
  pptx: {
    id: 'pptx',
    name: 'PowerPoint',
    extensions: ['.pptx', '.ppt'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
    ],
    description: 'Presentation slides with text, charts, and diagrams',
    icon: 'file-ppt',
  },
  xlsx: {
    id: 'xlsx',
    name: 'Excel Spreadsheet',
    extensions: ['.xlsx', '.xls', '.csv'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ],
    description: 'Spreadsheets with tabular data, formulas, and charts',
    icon: 'file-excel',
  },
  video: {
    id: 'video',
    name: 'Video',
    extensions: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
    mimeTypes: [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/webm',
    ],
    description: 'Video files for summarization, chapter extraction, and content moderation',
    icon: 'file-video',
  },
  audio: {
    id: 'audio',
    name: 'Audio',
    extensions: ['.mp3', '.wav', '.flac', '.m4a', '.ogg'],
    mimeTypes: [
      'audio/mpeg',
      'audio/wav',
      'audio/flac',
      'audio/mp4',
      'audio/ogg',
    ],
    description: 'Audio files for transcription, summarization, and content moderation',
    icon: 'file-audio',
  },
};

export function getDocumentType(fileName: string): DocumentType | null {
  const ext = '.' + fileName.split('.').pop()?.toLowerCase();
  for (const [type, info] of Object.entries(DOCUMENT_TYPE_INFO)) {
    if (info.extensions.includes(ext)) return type as DocumentType;
  }
  return null;
}

export function getAllAcceptedExtensions(): string[] {
  return Object.values(DOCUMENT_TYPE_INFO).flatMap((info) => info.extensions);
}

export function getAllAcceptedMimeTypes(): string[] {
  return Object.values(DOCUMENT_TYPE_INFO).flatMap((info) => info.mimeTypes);
}
