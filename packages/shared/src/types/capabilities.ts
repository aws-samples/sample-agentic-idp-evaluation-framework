/**
 * Capability types, categories, and helpers.
 *
 * CAPABILITY_INFO is derived from the generated SKILL_INFO (source: skills/*.md).
 * To add a new capability: create a .md file in packages/shared/skills/<category>/,
 * then run `npm run build:skills` to regenerate.
 */
import { SKILL_IDS, SKILL_INFO, type SkillInfo } from '../generated/skills.js';

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

// ─── Capabilities (derived from skill .md files) ─────────────────────────────

export const CAPABILITIES = SKILL_IDS;

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
  defaultFormat?: string;
  support?: Record<string, string>;
}

// Convert SKILL_INFO to CAPABILITY_INFO (preserving the interface all consumers expect)
export const CAPABILITY_INFO: Record<Capability, CapabilityInfo> = Object.fromEntries(
  Object.entries(SKILL_INFO).map(([id, skill]) => [
    id,
    {
      id: id as Capability,
      name: skill.name,
      description: skill.description,
      category: skill.category as CapabilityCategory,
      icon: skill.icon,
      tags: skill.tags,
      exampleInput: skill.exampleInput,
      exampleOutput: skill.exampleOutput,
      defaultFormat: skill.defaultFormat,
      support: skill.support,
    },
  ]),
) as Record<Capability, CapabilityInfo>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getCapabilitiesByCategory(
  category: CapabilityCategory,
): CapabilityInfo[] {
  return Object.values(CAPABILITY_INFO).filter((c) => c.category === category);
}

/**
 * Whether any method family can actually perform this capability.
 *
 * Two capabilities (pdf_conversion, format_standardization) declare no method
 * support because they are pipeline PREPROCESSING steps — file conversion done
 * in code before extraction — not things a model can be asked to do. They were
 * still being sent to every LLM in the capability list, where they fell through
 * to the generic "Extract <name> data." instruction and asked models to produce
 * output that does not exist. Callers building model prompts should filter
 * these out; the UI should present them as preprocessing, not as a model task.
 */
export function isModelBackedCapability(capability: Capability): boolean {
  const support = CAPABILITY_INFO[capability]?.support;
  if (!support) return false;
  return Object.values(support).some((level) => level && level !== 'none');
}

/** Capabilities a model can be asked to perform, preserving input order. */
export function filterModelBackedCapabilities<T extends string>(capabilities: readonly T[]): T[] {
  return capabilities.filter((c) => isModelBackedCapability(c as Capability));
}

/**
 * Why a capability is listed in the catalog but cannot be run by any method here.
 *
 * A capability with no runnable method is not automatically a mistake — it is often
 * a real IDP requirement this stack does not serve, and customers ask about them.
 * But "no support" and "unsupported for THIS reason" are very different messages,
 * and a row of grey dots conveys neither. Every unrunnable capability must name its
 * reason here so the UI can say WHY instead of showing an unexplained empty row.
 *
 * `needs` is the concrete thing that would make it work, so the entry doubles as
 * the implementation note.
 */
export const CAPABILITY_UNAVAILABLE_REASON: Partial<Record<Capability, {
  kind: 'preprocessing' | 'needs-deterministic-library' | 'needs-region' | 'needs-infrastructure';
  summary: string;
  needs: string;
}>> = {
  /*
   * Barcode/QR was rated `limited` across 17 methods, which claimed a partial
   * ability that does not exist. Measured against live Bedrock with a real QR code
   * (payload "IDP-TEST-QR-8842", 512x512 PNG): Opus 5 returned an empty string,
   * Sonnet 5 and Nova 2 Lite both answered CANNOT_DECODE. That is the expected
   * result, not a fluke — decoding is Reed-Solomon error correction over a sampled
   * module grid, an exact algorithm, not a perceptual task. A vision model can SEE
   * that a QR code is present and roughly where; it cannot read the payload, and a
   * plausible-looking guessed payload is worse than no answer.
   */
  barcode_qr: {
    kind: 'needs-deterministic-library',
    summary:
      'No model in this catalog can decode barcode or QR payloads. Verified against '
      + 'live Bedrock with a known QR code: Opus 5 returned nothing, Sonnet 5 and '
      + 'Nova 2 Lite both reported they could not decode it. Decoding is exact '
      + 'error-correcting math, not perception — a guessed payload is worse than none.',
    needs:
      'A deterministic decoder (ZXing / zbar / OpenCV QRCodeDetector) run in the '
      + 'pipeline, optionally with a vision model locating candidate regions first.',
  },
  pdf_conversion: {
    kind: 'preprocessing',
    summary: 'A file-conversion step the pipeline performs in code before extraction, not a model task.',
    needs: 'Already handled by the upload/convert stage; it is listed for reference only.',
  },
  format_standardization: {
    kind: 'preprocessing',
    summary: 'Output reformatting done in code after extraction, not something a model is asked to do.',
    needs: 'A post-processing formatter; nothing in this stack implements one yet.',
  },
  /*
   * Was rated bda "excellent" — the single most overstated cell the audit found.
   * Nothing image-shaped is produced at all: the invoke sends no
   * `standardOutputConfiguration`, so crops are never requested; `fetchOutput`
   * reads only the result JSON and no image asset; and `parseResults` has no
   * `image_separation` case, so it fell through to `default:` and answered with the
   * whole page's markdown at confidence 0.6 — the full document text returned under
   * the label "extracted images".
   */
  image_separation: {
    kind: 'needs-infrastructure',
    summary:
      'No method extracts embedded images. BDA is never asked for figure crops and no '
      + 'adapter surfaces an image asset, so this previously returned the page\'s text '
      + 'labelled as extracted images.',
    needs:
      'Request BDA crop generation via standardOutputConfiguration and surface the '
      + 'returned image assets, or emit the FIGURE elements (bbox + caption) that are '
      + 'already present in the BDA result and crop them locally.',
  },
  embedding_generation: {
    kind: 'needs-region',
    summary:
      'Maps only to the embeddings family, whose model '
      + '(amazon.nova-2-multimodal-embeddings-v1:0) is not offered in us-west-2 where '
      + 'this app runs, and which has no processor in any route registry.',
    needs: 'Deploy in us-east-1, or add a same-region embedding model plus a processor.',
  },
  knowledge_base_ingestion: {
    kind: 'needs-infrastructure',
    summary:
      'Needs an embedding model AND a vector store to ingest into. The embedding half '
      + 'has the same region problem as embedding_generation, and no vector store is '
      + 'provisioned by either stack.',
    needs: 'A Bedrock Knowledge Base (OpenSearch Serverless or Aurora pgvector) plus a same-region embedding model.',
  },
};

/**
 * Why this capability cannot run, or `undefined` if it can.
 *
 * Use this instead of inferring intent from an empty support row: an unrunnable
 * capability with no stated reason is indistinguishable from one the catalog simply
 * forgot to rate.
 */
export function getUnavailableReason(capability: Capability) {
  return CAPABILITY_UNAVAILABLE_REASON[capability];
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
