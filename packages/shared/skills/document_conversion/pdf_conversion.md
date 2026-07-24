---
id: "pdf_conversion"
name: "PDF Conversion"
description: "Preprocessing step, not a model capability. Office files (Word, Excel, PowerPoint) are parsed to text in-process before extraction so LLM methods can read them; PDFs and images are passed through natively. A production pipeline would render true PDFs here (for example Lambda with LibreOffice headless), which this demo does not do."
category: "document_conversion"
categoryName: "Document Conversion"
icon: "file-output"
defaultFormat: "json"
tags: ["pdf", "convert", "word", "excel", "pptx", "lambda", "libreoffice"]
exampleInput: "invoice.docx, report.xlsx, presentation.pptx"
exampleOutput: "Extracted text content ready for BDA or LLM extraction"
support:

---

# PDF Conversion

Preprocessing step, not a model capability. Office files are parsed to text in-process before extraction; PDFs and images pass through natively.

## When to use

Applies automatically when an uploaded file is an Office document. You do not select it as a model capability — no model performs it.

## Example

**Input**: invoice.docx, report.xlsx, presentation.pptx

**Output**: Standardized PDF files ready for BDA or LLM extraction

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

No method families currently support this capability.
