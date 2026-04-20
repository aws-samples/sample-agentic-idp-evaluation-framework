---
id: "knowledge_base_ingestion"
name: "Knowledge Base Ingestion"
description: "Ingest processed documents into Amazon Bedrock Knowledge Base for retrieval-augmented generation. Final pipeline step that enables AI-powered Q&A over your document corpus."
category: "advanced_ai"
categoryName: "Advanced AI"
icon: "library"
defaultFormat: "json"
tags: ["knowledge", "base", "rag", "ingestion", "bedrock", "retrieval", "qa"]
exampleInput: "Extracted text + embeddings from processing pipeline"
exampleOutput: "Documents indexed in Bedrock Knowledge Base, queryable via RetrieveAndGenerate API"
support:
  nova-embeddings: "excellent"
---

# Knowledge Base Ingestion

Ingest processed documents into Amazon Bedrock Knowledge Base for retrieval-augmented generation. Final pipeline step that enables AI-powered Q&A over your document corpus.

## When to use

Use this skill when the user needs to ingest processed documents into amazon bedrock knowledge base for retrieval-augmented generation. final pipeline step that enables ai-powered q&a over your document corpus..

## Example

**Input**: Extracted text + embeddings from processing pipeline

**Output**: Documents indexed in Bedrock Knowledge Base, queryable via RetrieveAndGenerate API

## Output format

Default format: `json`

Returns structured JSON with typed fields.

## Method support

- **nova-embeddings**: excellent
