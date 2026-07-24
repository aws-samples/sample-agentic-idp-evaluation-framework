---
id: "format_standardization"
name: "Format Standardization"
description: "Reference capability — not implemented in this demo. A production pipeline would normalize page size, orientation and rotation before extraction (for example Lambda with PyMuPDF or pikepdf). No model performs this, and this deployment does not run it."
category: "document_conversion"
categoryName: "Document Conversion"
icon: "ruler"
defaultFormat: "json"
tags: ["normalize", "standardize", "rotate", "split", "a4", "pymupdf", "pikepdf"]
exampleInput: "Mixed-orientation scanned PDF with varying page sizes"
exampleOutput: "Uniform A4 PDF with consistent orientation and page numbering"
support:

---

# Format Standardization

Reference capability. Not implemented in this demo — listed to document where page normalization belongs in a production IDP pipeline.

## When to use

Not selectable: no model performs this, and this deployment does not implement it. Shown for architecture reference only.

## Example

**Input**: Mixed-orientation scanned PDF with varying page sizes

**Output**: Uniform A4 PDF with consistent orientation and page numbering

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

No method families currently support this capability.
