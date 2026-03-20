/**
 * Shared icon system for capabilities and pipeline nodes.
 * Single source of truth — used by HomePage, CapabilityCards, Pipeline nodes, etc.
 */
import {
  FileText,
  PenLine,
  Table2,
  List,
  Users,
  Image,
  ScanSearch,
  PenTool,
  Barcode,
  LayoutGrid,
  FolderOpen,
  Scissors,
  AlignLeft,
  Globe,
  Shield,
  EyeOff,
  FileOutput,
  Ruler,
  ScanEye,
  GitCompareArrows,
  FileUp,
  SplitSquareHorizontal,
  Combine,
  FileJson,
  Video,
  Film,
  Mic,
  Headphones,
  ShieldAlert,
  ImageOff,
  Database,
  Library,
  type LucideIcon,
} from 'lucide-react';

export const DEFAULT_ICON_COLOR = '#545b64';

/** Lucide icon component for each capability */
export const CAPABILITY_ICON_MAP: Record<string, LucideIcon> = {
  text_extraction: FileText,
  handwriting_extraction: PenLine,
  table_extraction: Table2,
  kv_extraction: List,
  entity_extraction: Users,
  image_description: Image,
  bounding_box: ScanSearch,
  signature_detection: PenTool,
  barcode_qr: Barcode,
  layout_analysis: LayoutGrid,
  document_classification: FolderOpen,
  document_splitting: Scissors,
  document_summarization: AlignLeft,
  language_detection: Globe,
  pii_detection: Shield,
  pii_redaction: EyeOff,
  video_summarization: Video,
  video_chapter_extraction: Film,
  audio_transcription: Mic,
  audio_summarization: Headphones,
  content_moderation: ShieldAlert,
  image_separation: ImageOff,
  embedding_generation: Database,
  knowledge_base_ingestion: Library,
  pdf_conversion: FileOutput,
  format_standardization: Ruler,
  ocr_enhancement: ScanEye,
};

/** Pipeline infrastructure node icons */
export const PIPELINE_ICON_MAP: Record<string, LucideIcon> = {
  'document-input': FileUp,
  'page-classifier': SplitSquareHorizontal,
  aggregator: Combine,
  output: FileJson,
};

/** Get a rendered icon for a capability */
export function getCapabilityIcon(capabilityId: string, size = 16, color = DEFAULT_ICON_COLOR) {
  const IconComponent = CAPABILITY_ICON_MAP[capabilityId];
  if (!IconComponent) return null;
  return <IconComponent size={size} color={color} />;
}

/** Get a rendered icon for a pipeline node type */
export function getPipelineIcon(nodeType: string, size = 18, color = DEFAULT_ICON_COLOR) {
  const IconComponent = PIPELINE_ICON_MAP[nodeType];
  if (!IconComponent) return null;
  return <IconComponent size={size} color={color} />;
}
