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

export function searchCapabilities(query: string): CapabilityInfo[] {
  const q = query.toLowerCase();
  return Object.values(CAPABILITY_INFO).filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.tags.some((t) => t.includes(q)),
  );
}
