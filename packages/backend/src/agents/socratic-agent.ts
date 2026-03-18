import {
  ConverseStreamCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { Response } from 'express';
import type { ConversationEvent, CapabilityRecommendation } from '@idp/shared';
import { bedrockClient, config } from '../config/aws.js';
import { emitSSE } from '../services/streaming.js';
import { analyzeDocument } from './tools/analyze-document.js';
import { recommendCapabilities } from './tools/recommend-capabilities.js';

const SYSTEM_PROMPT = `You are a Socratic document processing advisor for an IDP (Intelligent Document Processing) platform. Guide users through understanding their document processing needs.

Your conversation flow:
1. Ask about document types they process
2. Ask about volume and frequency
3. Ask about accuracy requirements
4. Ask about specific data fields needed
5. Ask about downstream integrations

After gathering enough information (3-5 exchanges), provide capability recommendations.

When ready to recommend, include a JSON block in <recommendation> tags:
<recommendation>
{"capabilities": [{"capability": "table_extraction", "relevance": 0.9, "rationale": "reason"}]}
</recommendation>

Available capabilities organized by category:

**Core Extraction:**
- text_extraction: Extract printed text with layout preservation
- handwriting_extraction: Recognize handwritten text, notes, annotations
- table_extraction: Extract tables including nested/merged cells to HTML or CSV
- kv_extraction: Extract key-value pairs from forms and field-based documents
- entity_extraction: Extract names, dates, amounts, addresses, phone numbers, emails

**Visual Analysis:**
- image_description: Describe and interpret images, charts, graphs, diagrams
- bounding_box: Detect element locations with precise spatial coordinates
- signature_detection: Detect presence and location of signatures/initials/stamps
- barcode_qr: Detect and decode barcodes, QR codes, data matrix codes
- layout_analysis: Detect reading order, columns, sections, headers, footers

**Document Intelligence:**
- document_classification: Classify document type (invoice, contract, form, etc.)
- document_splitting: Split multi-document PDFs into logical documents
- document_summarization: Generate executive summaries and key points
- language_detection: Auto-detect document language

**Compliance & Security:**
- pii_detection: Detect SSN, credit cards, bank accounts, etc.
- pii_redaction: Automatically redact PII from extracted text

**Industry-Specific:**
- invoice_processing: Extract line items, totals, taxes, vendor/buyer info
- receipt_parsing: Parse receipts for items, prices, totals, store info
- check_processing: Extract amounts, payee, date, MICR line from checks
- insurance_claims: Extract claim details, policy info, damage assessment
- medical_records: Extract patient info, diagnoses, medications, treatment plans
- contract_analysis: Extract clauses, terms, obligations, deadlines, parties

Be conversational and concise. Ask one or two questions at a time.`;

export interface SocraticAgentOptions {
  documentId?: string;
  s3Uri?: string;
}

export async function runSocraticAgent(
  res: Response,
  messages: Message[],
  options: SocraticAgentOptions = {},
): Promise<void> {
  // If we have a document, try to pre-analyze it for context
  let documentContext = '';
  if (options.documentId && options.s3Uri) {
    try {
      const analysis = await analyzeDocument(options.documentId, options.s3Uri);
      documentContext = `\n\nDocument analysis context (use this to inform your questions):
- Type: ${analysis.documentType}
- Pages: ${analysis.pageCount}
- Has tables: ${analysis.hasTablesDetected}
- Has forms: ${analysis.hasFormsDetected}
- Has images: ${analysis.hasImagesDetected}
- Languages: ${analysis.languages.join(', ')}
- Summary: ${analysis.summary}`;
    } catch {
      // Document analysis failed, proceed without it
    }
  }

  const systemPrompt = SYSTEM_PROMPT + documentContext;

  const command = new ConverseStreamCommand({
    modelId: config.claudeModelId,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: {
      maxTokens: 2048,
      temperature: 0.7,
    },
  });

  const response = await bedrockClient.send(command);

  let fullText = '';

  if (response.stream) {
    for await (const event of response.stream) {
      if (event.contentBlockDelta?.delta?.text) {
        const chunk = event.contentBlockDelta.delta.text;
        fullText += chunk;

        const textEvent: ConversationEvent = { type: 'text', data: chunk };
        emitSSE(res, textEvent);
      }
    }
  }

  // Extract and emit recommendation if present
  const recMatch = fullText.match(/<recommendation>([\s\S]*?)<\/recommendation>/);
  if (recMatch) {
    try {
      const recData = JSON.parse(recMatch[1]);
      const recEvent: ConversationEvent = {
        type: 'recommendation',
        data: { capabilities: recData.capabilities as CapabilityRecommendation[] },
      };
      emitSSE(res, recEvent);
    } catch {
      // Parse failed
    }
  }

  // Fallback: use tool-based recommendations if the model doesn't produce structured output
  if (!recMatch && fullText.toLowerCase().includes('recommend')) {
    try {
      const userMessages = messages
        .filter((m) => m.role === 'user')
        .map((m) => {
          const textContent = m.content?.find((c) => 'text' in c);
          return textContent && 'text' in textContent ? textContent.text ?? '' : '';
        });

      if (options.s3Uri && options.documentId) {
        const analysis = await analyzeDocument(options.documentId, options.s3Uri);
        const recs = recommendCapabilities(analysis, userMessages);
        if (recs.length > 0) {
          const recEvent: ConversationEvent = {
            type: 'recommendation',
            data: { capabilities: recs },
          };
          emitSSE(res, recEvent);
        }
      }
    } catch {
      // Fallback recommendation failed
    }
  }
}
