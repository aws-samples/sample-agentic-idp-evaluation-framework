---
id: "format_standardization"
name: "Format Standardization"
description: "Normalize page sizes, orientations, and layouts. Detect and correct rotation, split multi-document PDFs, standardize to A4/Letter. Method Support: Lambda + PyMuPDF/pikepdf for lightweight ops, or Amazon Textract AnalyzeDocument for layout detection + Lambda for correction."
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

Normalize page sizes, orientations, and layouts. Detect and correct rotation, split multi-document PDFs, standardize to A4/Letter. Method Support: Lambda + PyMuPDF/pikepdf for lightweight ops, or Amazon Textract AnalyzeDocument for layout detection + Lambda for correction.

## When to use

Use this skill when the user needs to normalize page sizes, orientations, and layouts. detect and correct rotation, split multi-document pdfs, standardize to a4/letter. method support: lambda + pymupdf/pikepdf for lightweight ops, or amazon textract analyzedocument for layout detection + lambda for correction..

## Example

**Input**: Mixed-orientation scanned PDF with varying page sizes

**Output**: Uniform A4 PDF with consistent orientation and page numbering

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

No method families currently support this capability.
