import { Router } from 'express';
import type { ConversationRequest, ConversationEvent } from '@idp/shared';
import {
  ConverseStreamCommand,
  type Message,
  type ImageFormat,
} from '@aws-sdk/client-bedrock-runtime';
import sharp from 'sharp';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';
import { bedrockClient, config } from '../config/aws.js';
import { getDocumentBuffer } from '../services/s3.js';
import { getMethodLimitsSummary } from '@idp/shared';

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024; // 4.5MB (Bedrock limit is 5MB, leave margin)

async function resizeImageIfNeeded(buffer: Buffer, format: string): Promise<Buffer> {
  if (buffer.length <= MAX_IMAGE_BYTES) return buffer;

  // Resize to reduce file size while maintaining readability
  const ratio = Math.sqrt(MAX_IMAGE_BYTES / buffer.length);
  const metadata = await sharp(buffer).metadata();
  const newWidth = Math.round((metadata.width ?? 2000) * ratio);

  let img = sharp(buffer).resize({ width: newWidth, withoutEnlargement: true });

  if (format === 'jpeg' || format === 'jpg') {
    img = img.jpeg({ quality: 80 });
  } else if (format === 'png') {
    img = img.png({ compressionLevel: 8 });
  } else if (format === 'webp') {
    img = img.webp({ quality: 80 });
  } else {
    // Convert unsupported formats to jpeg
    img = img.jpeg({ quality: 80 });
  }

  const resized = await img.toBuffer();
  console.log(`[Conversation] Resized image: ${buffer.length} → ${resized.length} bytes (${newWidth}px wide)`);
  return resized;
}

const SOCRATIC_SYSTEM_PROMPT = `You are an IDP (Intelligent Document Processing) advisor. You analyze documents and guide users to the optimal processing approach through a structured interview.

STRICT RULES:
1. Do NOT use emojis. Never.
2. Respond in the SAME LANGUAGE as the document.
3. Use markdown formatting (bold, lists, tables).
4. Ask ONE focused question at a time.
5. After EVERY response, include:
   a) An ambiguity status table in <ambiguity> tags (see format below)
   b) Clickable options in <options> tags as the LAST element

AMBIGUITY TRACKING:
You must maintain an internal ambiguity score (0-100%) for each dimension. Include this after every response:

<ambiguity>
{"scores":{"document_type":0,"processing_goal":100,"volume":100,"accuracy":100,"fields":100,"integration":100},"overall":83,"passed":false}
</ambiguity>

Dimensions:
- document_type: What kind of document (0% = identified from upload)
- processing_goal: What the user wants to do with it
- volume: How many documents, how often
- accuracy: Required accuracy level
- fields: Which specific fields/data to extract
- integration: Where the output goes

Rules:
- Start document_type at 0% if you can identify the document from the upload
- Each user answer should reduce the relevant dimension by 50-100%
- When overall ambiguity drops below 20%, set passed=true and provide recommendations
- Ask about the HIGHEST ambiguity dimension first

CONVERSATION FLOW:

Turn 1 (auto-init): Analyze the document.
- Identify document type, key fields, structure, language
- Show what you found as a structured summary
- Set document_type ambiguity to 0% (identified from document)
- Ask about processing goal (highest remaining ambiguity)

Turn 2+: Ask about the dimension with HIGHEST ambiguity.
- Tailor questions to the document type
- Options should be specific and relevant

When passed=true (overall < 20%): Provide capability recommendations.
Include a <recommendation> tag with capabilities and method hints:
<recommendation>
{"capabilities": [
  {"capability": "capability_id", "relevance": 0.9, "rationale": "reason",
   "bestMethods": ["claude", "bda"],
   "canBundle": ["other_capability_id"]}
]}
</recommendation>

CAPABILITY REFERENCE (22 capabilities, 4 method families):

**Core Extraction** — Most can be bundled in a single LLM call:
- text_extraction [LLM:excellent, BDA:excellent, Textract:excellent]
- handwriting_extraction [LLM:excellent, BDA:good, Textract:good]
- table_extraction [LLM:excellent, BDA:good, Textract:excellent]
- kv_extraction [LLM:excellent, BDA:good, Textract:excellent]
- entity_extraction [LLM:excellent, BDA:good, Textract:limited]

**Visual Analysis** — LLM handles most; Textract for bounding boxes:
- image_description [LLM:excellent, BDA:limited, Textract:none]
- bounding_box [LLM:good, BDA:none, Textract:excellent]
- signature_detection [LLM:good, BDA:limited, Textract:good]
- barcode_qr [LLM:limited, BDA:none, Textract:good]
- layout_analysis [LLM:good, BDA:good, Textract:excellent]

**Document Intelligence** — LLM excels; BDA for splitting:
- document_classification [LLM:excellent, BDA:good, Textract:none]
- document_splitting [LLM:good, BDA:excellent, Textract:none]
- document_summarization [LLM:excellent, BDA:good, Textract:none]
- language_detection [LLM:excellent, BDA:good, Textract:limited]

**Compliance & Security** — LLM for detection; specialized tools for redaction:
- pii_detection [LLM:excellent, BDA:limited, Textract:none]
- pii_redaction [LLM:good, BDA:none, Textract:none]

**Industry-Specific** — BDA excels for invoices/receipts; LLM for complex docs:
- invoice_processing [LLM:good, BDA:excellent, Textract:good]
- receipt_parsing [LLM:good, BDA:excellent, Textract:good]
- check_processing [LLM:good, BDA:good, Textract:excellent]
- insurance_claims [LLM:excellent, BDA:good, Textract:limited]
- medical_records [LLM:excellent, BDA:good, Textract:limited]
- contract_analysis [LLM:excellent, BDA:limited, Textract:none]

BUNDLING RULES:
- A single LLM call (Claude/Nova) can handle ALL capabilities simultaneously via system prompt
- BDA processes per-document with a fixed set of outputs (best for invoices, receipts, splitting)
- Textract extracts OCR/layout, then LLM structures it (two-phase)
- Recommend bundling when 3+ capabilities share the same best method family

<options> must be the LAST element in your response, on its own line.

METHOD LIMITS & CONSTRAINTS (use when recommending methods):
` + getMethodLimitsSummary();

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as ConversationRequest;

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    const messages: Message[] = [];
    const isInit = body.message === '__init__';

    // Add conversation history
    for (const msg of body.history) {
      messages.push({
        role: msg.role,
        content: [{ text: msg.content }],
      });
    }

    // Build the user message
    const userText = isInit
      ? 'I just uploaded this document. Please analyze it and tell me what you see, then ask me what I want to do with it. Provide clickable options.'
      : body.message;

    // Try to include document content for the first message
    if (body.documentId && messages.length === 0) {
      try {
        const s3Uri = body.s3Uri ?? `s3://${config.s3Bucket}/uploads/${body.documentId}/`;
        // For local storage, we need the actual file path
        const docBuffer = await getDocumentBuffer(s3Uri);

        // Determine format from s3Uri
        const isPdf = s3Uri.toLowerCase().includes('.pdf');
        const isImage = /\.(jpg|jpeg|png|tiff|tif|bmp|gif|webp)$/i.test(s3Uri);

        if (isPdf) {
          messages.push({
            role: 'user' as const,
            content: [
              {
                document: {
                  name: 'uploaded-document',
                  format: 'pdf',
                  source: { bytes: docBuffer },
                },
              },
              { text: userText },
            ],
          });
        } else if (isImage) {
          const ext = s3Uri.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'png';
          const formatMap: Record<string, ImageFormat> = {
            jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp',
            tiff: 'jpeg', tif: 'jpeg', bmp: 'jpeg',
          };
          const imgFormat = formatMap[ext] ?? 'jpeg';
          // Resize if over Bedrock's 5MB limit
          const resizedBuffer = await resizeImageIfNeeded(docBuffer, ext);
          messages.push({
            role: 'user' as const,
            content: [
              {
                image: {
                  format: imgFormat,
                  source: { bytes: resizedBuffer },
                },
              },
              { text: userText },
            ],
          });
        } else {
          // Non-visual document, just send as text context
          messages.push({
            role: 'user' as const,
            content: [{ text: userText }],
          });
        }
      } catch (err) {
        console.warn('[Conversation] Failed to load document buffer:', err);
        messages.push({
          role: 'user' as const,
          content: [{ text: userText }],
        });
      }
    } else {
      messages.push({
        role: 'user' as const,
        content: [{ text: userText }],
      });
    }

    async function streamConverse(msgs: Message[]): Promise<string> {
      const command = new ConverseStreamCommand({
        modelId: config.claudeModelId,
        system: [{ text: SOCRATIC_SYSTEM_PROMPT }],
        messages: msgs,
        inferenceConfig: {
          maxTokens: 2048,
          temperature: 0.7,
        },
      });

      const response = await bedrockClient.send(command);
      let text = '';
      if (response.stream) {
        for await (const event of response.stream) {
          if (event.contentBlockDelta?.delta?.text) {
            const chunk = event.contentBlockDelta.delta.text;
            text += chunk;
            emitSSE(res, { type: 'text', data: chunk } as ConversationEvent);
          }
        }
      }
      return text;
    }

    let fullText: string;
    try {
      fullText = await streamConverse(messages);
    } catch (firstErr) {
      // If Bedrock rejects the document (invalid PDF, etc.), retry text-only
      console.warn('[Conversation] Bedrock rejected document, retrying text-only:', (firstErr as Error).message);
      const textOnlyMessages: Message[] = [{
        role: 'user' as const,
        content: [{ text: userText }],
      }];
      fullText = await streamConverse(textOnlyMessages);
    }

    // Check for recommendation
    const recMatch = fullText.match(/<recommendation>([\s\S]*?)<\/recommendation>/);
    if (recMatch) {
      try {
        const recData = JSON.parse(recMatch[1]);
        const recEvent: ConversationEvent = {
          type: 'recommendation',
          data: { capabilities: recData.capabilities },
        };
        emitSSE(res, recEvent);
      } catch {
        // Recommendation parsing failed
      }
    }

    const doneEvent: ConversationEvent = { type: 'done' };
    emitSSE(res, doneEvent);
  } catch (err) {
    console.error('[Conversation Error]', err);
    emitSSE(res, { type: 'text', data: 'I encountered an error processing your request. Please try again.' });
    emitSSE(res, { type: 'done' });
  } finally {
    endSSE(res, keepalive);
  }
});

export default router;
