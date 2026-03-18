/**
 * Strands SDK-based Socratic Agent
 * Uses Strands Agent + BedrockModel + tool() for agentic orchestration.
 * Conversation history passed via Agent config.messages (MessageData[]).
 */
import { Agent, BedrockModel, NullConversationManager, tool } from '@strands-agents/sdk';
import { z } from 'zod';
import type { Response } from 'express';
import type { ConversationEvent, CapabilityRecommendation } from '@idp/shared';
import { config } from '../config/aws.js';
import { emitSSE } from '../services/streaming.js';
import { analyzeDocument } from './tools/analyze-document.js';
import { recommendCapabilities } from './tools/recommend-capabilities.js';

export interface SocraticAgentOptions {
  documentId?: string;
  s3Uri?: string;
}

// Strands tool: analyze uploaded document
const analyzeDocumentTool = tool({
  name: 'analyze_document',
  description: 'Analyze an uploaded document to understand its structure, content types, and characteristics. Use this when you first receive a document to understand what it contains.',
  inputSchema: z.object({
    documentId: z.string().describe('The document ID'),
    s3Uri: z.string().describe('The S3 URI of the document'),
  }),
  callback: async (input) => {
    const analysis = await analyzeDocument(input.documentId, input.s3Uri);
    return JSON.stringify(analysis);
  },
});

// Strands tool: recommend capabilities based on analysis + user needs
const recommendCapabilitiesTool = tool({
  name: 'recommend_capabilities',
  description: 'Based on document analysis and user requirements gathered from conversation, recommend the optimal set of IDP capabilities. Call this after gathering enough information (3-5 exchanges).',
  inputSchema: z.object({
    documentId: z.string().describe('The document ID'),
    s3Uri: z.string().describe('The S3 URI of the document'),
    userRequirements: z.array(z.string()).describe('Key requirements gathered from the conversation'),
  }),
  callback: async (input) => {
    const analysis = await analyzeDocument(input.documentId, input.s3Uri);
    const recs = recommendCapabilities(analysis, input.userRequirements);
    return JSON.stringify({ capabilities: recs });
  },
});

function buildSystemPrompt(
  options: SocraticAgentOptions,
  historyLength: number,
): string {
  const docContext = options.documentId && options.s3Uri
    ? `\n\nDOCUMENT CONTEXT: A document has ALREADY been uploaded and is available for processing.
- documentId: "${options.documentId}"
- s3Uri: "${options.s3Uri}"
You MUST use these exact values when calling analyze_document or recommend_capabilities.
NEVER ask the user to upload a document or provide IDs — the document is already available.`
    : '';

  const historyContext = historyLength > 0
    ? `\n\nCONVERSATION STATE: This is a CONTINUATION of an existing conversation (${historyLength} prior messages). The document has ALREADY been analyzed in a previous turn — the analysis summary is in the conversation history. Do NOT call analyze_document again.`
    : '';

  return `You are a Socratic document processing advisor for an IDP (Intelligent Document Processing) evaluation platform.${docContext}${historyContext}

STRICT RULES:
1. Do NOT use emojis. Never.
2. Respond in the SAME LANGUAGE as the document content.
3. Use markdown formatting (bold, lists, tables).
4. Ask ONE focused question at a time.
5. After EVERY response, include clickable options in <options> tags as the LAST element.
6. NEVER ask the user to upload a document or provide document IDs.
7. Keep the conversation focused on understanding what the user wants to DO with the document.

TOOL USAGE RULES:
- Call analyze_document ONLY ONCE — on the very first turn when there is NO conversation history.
- If conversation history exists, the analysis is already there. Do NOT call analyze_document again.
- Call recommend_capabilities ONLY ONCE when you have gathered enough information.
- If the user asks to extract/process, respond based on existing conversation context.

CONVERSATION FLOW:
Turn 1 (init, empty history): Use analyze_document tool, then present a detailed content summary. Ask about processing goal.
Turn 2-4: Based on the analysis already in the conversation, ask about specifics — volume, accuracy, target fields, output format. Do NOT call analyze_document again.
Turn 5+: When you have enough info, use recommend_capabilities tool and present recommendations.

OPTIONS FORMAT (MANDATORY after every response):
<options>
- Short option text here
- Another option
- A third option
</options>

OPTIONS RULES:
- 3-6 options per response
- Each option on its own line starting with "- "
- Keep options short (under 40 characters)
- <options> must be the VERY LAST thing in your response

CAPABILITY IDS (for recommend_capabilities):
text_extraction, handwriting_extraction, table_extraction, kv_extraction, entity_extraction,
image_description, bounding_box, signature_detection, barcode_qr, layout_analysis,
document_classification, document_splitting, document_summarization, language_detection,
pii_detection, pii_redaction, invoice_processing, receipt_parsing, check_processing,
insurance_claims, medical_records, contract_analysis,
video_summarization, video_chapter_extraction, audio_transcription, audio_summarization, content_moderation

When you have recommendations, ALSO include them in <recommendation> tags:
<recommendation>
{"capabilities": [{"capability": "capability_id", "relevance": 0.9, "rationale": "reason"}]}
</recommendation>`;
}

/**
 * Convert frontend conversation history to Strands MessageData format.
 * Each message becomes {role, content: [{text}]}.
 */
function historyToMessageData(
  history: Array<{ role: string; content: string }>,
): Array<{ role: 'user' | 'assistant'; content: Array<{ text: string }> }> {
  return history.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: [{ text: msg.content }],
  }));
}

/**
 * Run the Socratic agent using Strands SDK.
 * Passes conversation history via Agent constructor config.messages.
 * Streams new response via SSE.
 */
export async function runSocraticAgentStrands(
  res: Response,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  options: SocraticAgentOptions = {},
): Promise<void> {
  const model = new BedrockModel({
    modelId: config.claudeModelId,
    region: config.region,
    maxTokens: 2048,
    temperature: 0.7,
  });

  // Convert history to MessageData[] for the Agent constructor
  const priorMessages = historyToMessageData(conversationHistory);

  const agent = new Agent({
    model,
    tools: [analyzeDocumentTool, recommendCapabilitiesTool],
    systemPrompt: buildSystemPrompt(options, conversationHistory.length),
    // Pass conversation history as initial messages (MessageData[])
    messages: priorMessages,
    // Disable conversation manager trimming — we manage history on the frontend
    conversationManager: new NullConversationManager(),
    printer: false,
    name: 'socratic-advisor',
    description: 'IDP document processing advisor',
  });

  // Build the current user message
  let messageContent = userMessage;
  if (conversationHistory.length === 0 && options.documentId && options.s3Uri) {
    messageContent = `A document has been uploaded (documentId="${options.documentId}", s3Uri="${options.s3Uri}"). ${userMessage}\n\nAnalyze the document using the analyze_document tool.`;
  }

  // Stream the agent response via SSE
  try {
    let fullText = '';

    for await (const event of agent.stream(messageContent)) {
      const e = event as any;

      // Text streaming — ModelStreamUpdateEvent wraps ModelContentBlockDeltaEvent
      if (
        e.type === 'modelStreamUpdateEvent' &&
        e.event?.type === 'modelContentBlockDeltaEvent' &&
        e.event?.delta?.type === 'textDelta'
      ) {
        const chunk = e.event.delta.text as string;
        fullText += chunk;
        emitSSE(res, { type: 'text', data: chunk } as ConversationEvent);
      }

      // Tool call start — BeforeToolCallEvent
      if (e.type === 'beforeToolCallEvent' && e.toolUse?.name) {
        emitSSE(res, {
          type: 'tool_use',
          data: { name: e.toolUse.name, input: e.toolUse.input },
        } as ConversationEvent);
      }

      // Tool result — AfterToolCallEvent (result is ToolResultBlock)
      if (e.type === 'afterToolCallEvent' && e.toolUse?.name) {
        // Extract text from ToolResultBlock.content[]
        const resultText = e.result?.content
          ?.map((c: any) => c.text ?? '')
          ?.join('') ?? '';

        emitSSE(res, {
          type: 'tool_result',
          data: { name: e.toolUse.name, result: resultText },
        } as ConversationEvent);

        // If recommend_capabilities was called, emit recommendation event
        if (e.toolUse.name === 'recommend_capabilities' && resultText) {
          try {
            const parsed = JSON.parse(resultText);
            if (parsed.capabilities) {
              emitSSE(res, {
                type: 'recommendation',
                data: { capabilities: parsed.capabilities as CapabilityRecommendation[] },
              } as ConversationEvent);
            }
          } catch {
            // Parse failed
          }
        }
      }
    }

    // Extract recommendation from final text if not already emitted via tool
    const recMatch = fullText.match(/<recommendation>([\s\S]*?)<\/recommendation>/);
    if (recMatch) {
      try {
        const recData = JSON.parse(recMatch[1]);
        emitSSE(res, {
          type: 'recommendation',
          data: { capabilities: recData.capabilities as CapabilityRecommendation[] },
        } as ConversationEvent);
      } catch {
        // Parse failed
      }
    }
  } catch (err) {
    console.error('[Strands Socratic Agent Error]', err);
    emitSSE(res, {
      type: 'text',
      data: '\n\nI encountered an issue processing your request. Please try again.',
    } as ConversationEvent);
  }
}
