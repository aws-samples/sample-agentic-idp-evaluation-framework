---
title: Capabilities
description: 33 capabilities across 8 categories.
---

# Capabilities

ONE IDP ships **33 capabilities** grouped into **8 categories**. A "capability" is the unit of extraction — the agent picks which ones apply to your document, and the pipeline assigns a method per capability.

Capabilities live as individual markdown files under `packages/shared/skills/<category>/<capability>.md`. At build time (`npm run build:skills`), they're compiled into `packages/shared/src/generated/skills.ts` which becomes the source of truth for both the backend and the frontend.

Each skill .md contains: name, description, category, icon, tags, default output format, example input/output, and a support-level matrix mapping each method family to `excellent | good | limited | none`.

## The 8 categories

| Category | Count | Theme |
|---|---|---|
| **Core Extraction** | 5 | Fundamental text, tables, and key-value extraction. |
| **Visual Analysis** | 5 | Image description, layout, bounding boxes, signatures, barcodes. |
| **Document Intelligence** | 4 | Classification, splitting, summarization, language detection. |
| **Compliance & Security** | 2 | PII detection and redaction. |
| **Industry-Specific** | 6 | Invoice, receipt, check, insurance claim, medical record, contract. |
| **Media Processing** | 5 | Video/audio summarization, transcription, content moderation. |
| **Advanced AI** | 3 | Image separation, multimodal embeddings, KB ingestion. |
| **Document Conversion** | 3 | Format standardization, OCR enhancement, PDF conversion. |

Colors are stable per category and come from `packages/shared/src/types/capabilities.ts:CATEGORY_INFO`:

- Core Extraction `#0972d3`
- Visual Analysis `#037f0c`
- Document Intelligence `#8b5cf6`
- Compliance & Security `#d91515`
- Industry-Specific `#ec7211`
- Media Processing `#9469d6`
- Advanced AI `#2563eb`
- Document Conversion `#7c3aed`

## The support matrix

Each skill declares how well each method family handles it. Example from a skill .md:

```yaml
support:
  claude: excellent
  nova: good
  bda: limited
  bda-llm: excellent
  textract-llm: excellent
  embeddings: none
```

The support matrix drives:

- **Capability selection in conversation** — the agent filters out methods with `none` support.
- **Smart pipeline routing** — when the smart endpoint chooses the assignment, it prefers `excellent` over `good`.
- **Comparison view** — the capability matrix in the comparison UI renders this directly.

## Adding a new capability

1. Create `packages/shared/skills/<category>/<capability>.md` with the frontmatter and support matrix.
2. Run `npm run build:skills -w packages/shared`.
3. Rebuild `shared`, then `backend` and `frontend`.

The new capability is automatically picked up by the UI, the agent, and the code generator.

## Capability → format mapping

Each capability has a `defaultFormat` (text, html, csv, json, markdown, image). The `TokenStreamAdapter`'s YAML parser coerces model output into that format per capability. For example:

- `table_extraction` → `html` (`<table><thead>…</thead></table>`)
- `kv_extraction` → `json` (`{ key: value }`)
- `document_summarization` → `text` (plain paragraphs, never a table)
- `entity_extraction` → `json` (`[{ type, value, page? }]`)

See `packages/backend/src/adapters/token-stream-adapter.ts:41–52` (`CAPABILITY_GUIDANCE`) for the exact extraction prompt per capability.
