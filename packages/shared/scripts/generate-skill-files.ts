#!/usr/bin/env npx tsx
/**
 * Generate skill .md files from existing CAPABILITY_INFO.
 * Run once to create the initial files, then maintain the .md files as SSOT.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CAPABILITY_INFO, CATEGORY_INFO } from '../src/types/capabilities.js';
import { CAPABILITY_SUPPORT, METHOD_FAMILIES } from '../src/types/processing.js';

const SKILLS_DIR = join(import.meta.dirname, '..', 'skills');

for (const [id, info] of Object.entries(CAPABILITY_INFO)) {
  const categoryDir = join(SKILLS_DIR, info.category);
  mkdirSync(categoryDir, { recursive: true });

  // Build support levels from CAPABILITY_SUPPORT matrix
  const support: Record<string, string> = {};
  for (const family of METHOD_FAMILIES) {
    const level = CAPABILITY_SUPPORT[family]?.[id as keyof typeof CAPABILITY_SUPPORT[typeof family]];
    if (level && level !== 'none') {
      support[family] = level;
    }
  }

  // Determine default output format based on capability type
  const defaultFormat =
    id === 'table_extraction' ? 'html'
    : id === 'text_extraction' || id === 'document_summarization' || id === 'handwriting_extraction' ? 'text'
    : id.includes('detection') || id.includes('classification') || id.includes('splitting') ? 'json'
    : id === 'layout_analysis' || id === 'bounding_box' ? 'json'
    : id.includes('moderation') ? 'json'
    : 'json';

  const categoryName = CATEGORY_INFO[info.category].name;

  const md = `---
id: "${id}"
name: "${info.name}"
description: "${info.description}"
category: "${info.category}"
categoryName: "${categoryName}"
icon: "${info.icon}"
defaultFormat: "${defaultFormat}"
tags: [${info.tags.map(t => `"${t}"`).join(', ')}]
support:
${Object.entries(support).map(([f, l]) => `  ${f}: "${l}"`).join('\n')}
---

# ${info.name}

${info.description}

## When to use

Use this skill when the user needs to ${info.description.toLowerCase().replace(/^extract |^detect |^recognize |^generate |^auto-/i, '').trim()}.

## Example

**Input**: ${info.exampleInput}

**Output**: ${info.exampleOutput}

## Output format

Default format: \`${defaultFormat}\`

${defaultFormat === 'html' ? 'Returns structured HTML (e.g., `<table>` elements with `<thead>` and `<tbody>`).' :
  defaultFormat === 'text' ? 'Returns plain text with preserved structure and formatting.' :
  'Returns structured JSON with typed fields.'}

## Method support

${Object.entries(support).length > 0 ?
  Object.entries(support).map(([f, l]) => `- **${f}**: ${l}`).join('\n') :
  'No method families currently support this capability.'}
`;

  const filePath = join(categoryDir, `${id}.md`);
  writeFileSync(filePath, md);
  console.log(`  ${info.category}/${id}.md`);
}

console.log(`\nGenerated ${Object.keys(CAPABILITY_INFO).length} skill files.`);
