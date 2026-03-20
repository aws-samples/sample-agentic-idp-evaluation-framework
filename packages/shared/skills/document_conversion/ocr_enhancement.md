---
id: "ocr_enhancement"
name: "OCR Enhancement"
description: "Pre-process scanned images for better extraction accuracy: deskew, denoise, contrast enhancement, binarization. Method Support: Lambda + OpenCV/Pillow for image preprocessing, then Amazon Textract for OCR, or BDA with overrideConfiguration for enhanced extraction. Critical for low-quality fax/scan inputs."
category: "document_conversion"
categoryName: "Document Conversion"
icon: "scan-eye"
defaultFormat: "json"
tags: ["ocr", "enhance", "deskew", "denoise", "scan", "opencv", "textract", "preprocess"]
exampleInput: "Low-quality scan with noise, skew, and poor contrast"
exampleOutput: "Enhanced image with improved OCR accuracy (90%+ character recognition)"
support:
  textract-llm: "limited"
---

# OCR Enhancement

Pre-process scanned images for better extraction accuracy: deskew, denoise, contrast enhancement, binarization. Method Support: Lambda + OpenCV/Pillow for image preprocessing, then Amazon Textract for OCR, or BDA with overrideConfiguration for enhanced extraction. Critical for low-quality fax/scan inputs.

## When to use

Use this skill when the user needs to pre-process scanned images for better extraction accuracy: deskew, denoise, contrast enhancement, binarization. method support: lambda + opencv/pillow for image preprocessing, then amazon textract for ocr, or bda with overrideconfiguration for enhanced extraction. critical for low-quality fax/scan inputs..

## Example

**Input**: Low-quality scan with noise, skew, and poor contrast

**Output**: Enhanced image with improved OCR accuracy (90%+ character recognition)

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **textract-llm**: limited
