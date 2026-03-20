#!/usr/bin/env npx tsx
/**
 * Build script: reads skill .md files and generates TypeScript constants.
 * This is the bridge from .md SSOT → TypeScript types used by the app.
 *
 * Usage: npx tsx scripts/build-skills.ts
 * Output: src/generated/skills.ts
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const SKILLS_DIR = join(import.meta.dirname, '..', 'skills');
const OUTPUT_DIR = join(import.meta.dirname, '..', 'src', 'generated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'skills.ts');

interface SkillFrontmatter {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  icon: string;
  defaultFormat: string;
  tags: string[];
  support: Record<string, string>;
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('No YAML frontmatter found');

  const yamlStr = match[1];
  const body = match[2].trim();

  // Simple YAML parser (no external dependency needed)
  const fm: Record<string, unknown> = {};
  let currentKey = '';
  let inSupport = false;
  const support: Record<string, string> = {};

  for (const line of yamlStr.split('\n')) {
    if (line.startsWith('support:')) {
      inSupport = true;
      continue;
    }

    if (inSupport) {
      const supportMatch = line.match(/^\s+(.+?):\s*"(.+?)"/);
      if (supportMatch) {
        support[supportMatch[1]] = supportMatch[2];
        continue;
      } else if (!line.startsWith(' ')) {
        inSupport = false;
      } else {
        continue;
      }
    }

    const kvMatch = line.match(/^(\w+):\s*(.+)/);
    if (kvMatch) {
      const [, key, rawVal] = kvMatch;
      currentKey = key;

      // Handle arrays: [a, b, c]
      if (rawVal.startsWith('[')) {
        const items = rawVal.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, ''));
        fm[key] = items;
      }
      // Handle quoted strings
      else if (rawVal.startsWith('"')) {
        fm[key] = rawVal.replace(/^"|"$/g, '');
      }
      else {
        fm[key] = rawVal;
      }
    }
  }

  fm.support = support;

  return {
    frontmatter: fm as unknown as SkillFrontmatter,
    body,
  };
}

// Collect all .md files from skills/ subdirectories
const skills: SkillFrontmatter[] = [];
const categoryDirs = readdirSync(SKILLS_DIR).filter(d =>
  statSync(join(SKILLS_DIR, d)).isDirectory()
);

for (const catDir of categoryDirs) {
  const catPath = join(SKILLS_DIR, catDir);
  const mdFiles = readdirSync(catPath).filter(f => f.endsWith('.md'));

  for (const mdFile of mdFiles) {
    const content = readFileSync(join(catPath, mdFile), 'utf-8');
    const { frontmatter } = parseFrontmatter(content);
    skills.push(frontmatter);
  }
}

// Sort by category order, then by id
const CATEGORY_ORDER = [
  'core_extraction', 'visual_analysis', 'document_intelligence',
  'compliance_security', 'industry_specific', 'media_processing',
  'advanced_ai', 'document_conversion',
];
skills.sort((a, b) => {
  const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  return catDiff !== 0 ? catDiff : a.id.localeCompare(b.id);
});

// Generate TypeScript
const capIds = skills.map(s => `'${s.id}'`).join(',\n  ');
const capInfoEntries = skills.map(s => {
  const tags = s.tags.map(t => `'${t}'`).join(', ');
  const supportEntries = Object.entries(s.support)
    .map(([f, l]) => `    '${f}': '${l}' as const`)
    .join(',\n');

  return `  '${s.id}': {
    id: '${s.id}',
    name: '${s.name}',
    description: '${s.description.replace(/'/g, "\\'")}',
    category: '${s.category}',
    icon: '${s.icon}',
    defaultFormat: '${s.defaultFormat}',
    tags: [${tags}],
    exampleInput: '',
    exampleOutput: '',
    support: {
${supportEntries}
    },
  }`;
}).join(',\n');

const output = `/**
 * Auto-generated from skill definition files.
 * Do not edit manually - run: npx tsx scripts/build-skills.ts
 */

// Skill IDs (capabilities)
export const SKILL_IDS = [
  ${capIds},
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
${capInfoEntries},
};

// Re-export as capability aliases for backward compatibility
export const GENERATED_CAPABILITIES = SKILL_IDS;
export const GENERATED_CAPABILITY_INFO = SKILL_INFO;
`;

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_FILE, output);

console.log(`Generated ${skills.length} skills → ${OUTPUT_FILE}`);
