/**
 * Strands SDK-based Socratic Agent
 * Uses Strands Agent + BedrockModel + tool() for agentic orchestration.
 * Conversation history passed via Agent config.messages (MessageData[]).
 */
import { Agent, BedrockModel, NullConversationManager, tool } from '@strands-agents/sdk';
import { z } from 'zod';
import type { Response } from 'express';
import type { ConversationEvent, CapabilityRecommendation } from '@idp/shared';
import { CAPABILITIES } from '@idp/shared';
import { config } from '../config/aws.js';
import { emitSSE } from '../services/streaming.js';
import { analyzeDocument } from './tools/analyze-document.js';
import { validateRecommendations } from './tools/recommend-capabilities.js';

export interface SocraticAgentOptions {
  documentId?: string;
  s3Uri?: string;
}

/**
 * Create tools with closure-bound document context.
 * This avoids relying on the LLM to pass Korean/CJK s3Uri strings correctly.
 */
function createTools(options: SocraticAgentOptions) {
  const boundDocumentId = options.documentId ?? '';
  const boundS3Uri = options.s3Uri ?? '';

  const analyzeDocumentTool = tool({
    name: 'analyze_document',
    description: 'Analyze the uploaded document to understand its structure, content types, and characteristics. Use this when you first receive a document to understand what it contains. No parameters needed — the document context is already bound.',
    inputSchema: z.object({}),
    callback: async () => {
      console.log('[Tool:analyze_document] Using bound context:', boundDocumentId, boundS3Uri);
      const analysis = await analyzeDocument(boundDocumentId, boundS3Uri);
      return JSON.stringify(analysis);
    },
  });

  const recommendCapabilitiesTool = tool({
    name: 'recommend_capabilities',
    description: 'Submit YOUR recommended capabilities with relevance scores based on the conversation. You determine the scores — the tool validates and returns them for UI display. Call this after gathering enough information (3-5 exchanges).',
    inputSchema: z.object({
      recommendations: z.array(z.object({
        capability: z.string().describe('Capability ID from the provided list'),
        relevance: z.number().describe('Relevance score 0.0-1.0 based on conversation context'),
        rationale: z.string().describe('Brief explanation of why this capability is relevant'),
      })).describe('Your recommended capabilities — only include truly relevant ones'),
    }),
    callback: async (input) => {
      console.log('[Tool:recommend_capabilities] Using bound context:', boundDocumentId, boundS3Uri);
      const analysis = await analyzeDocument(boundDocumentId, boundS3Uri);
      const recs = validateRecommendations(input.recommendations, analysis);
      return JSON.stringify({ capabilities: recs, documentLanguages: analysis.languages });
    },
  });

  return [analyzeDocumentTool, recommendCapabilitiesTool];
}

function buildSystemPrompt(
  options: SocraticAgentOptions,
  historyLength: number,
): string {
  const docContext = options.documentId && options.s3Uri
    ? `\n\nDOCUMENT CONTEXT: A document has ALREADY been uploaded and is available for processing.
The document context is automatically bound to the tools — you do NOT need to pass documentId or s3Uri as parameters.
Simply call analyze_document() with no arguments, or recommend_capabilities(recommendations=[...]).
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
8. NEVER refuse based on document size or page count. The platform handles large documents automatically — analyze_document returns a sampled summary for very large PDFs. Treat that summary as authoritative and proceed with the normal flow.
9. NEVER tell the user to split the PDF, contact an admin, or that the document "exceeds a 100-page limit". There is no such user-facing limit — downstream capabilities (Document Splitting, PII Redaction, etc.) are chosen via recommend_capabilities.

TOOL USAGE RULES:
- Call analyze_document ONLY ONCE — on the very first turn when there is NO conversation history.
- If conversation history exists, the analysis is already there. Do NOT call analyze_document again.
- Call recommend_capabilities ONLY ONCE when you have gathered enough information.
- If the user asks to extract/process, respond based on existing conversation context.

CONVERSATION FLOW:
Turn 1 (init, empty history): Use analyze_document tool, then present a detailed content summary. Ask about processing goal.
Turn 2-4: Based on the analysis already in the conversation, ask about specifics — volume, accuracy, target fields, output format. Do NOT call analyze_document again.
Turn 5+: When you have enough info, use recommend_capabilities tool and present recommendations.

AFTER RECOMMENDING:
Once you have called recommend_capabilities and presented the results:
- Tell the user the capabilities have been selected and they can click the **"Run Preview"** button in the capabilities section below to test extraction.
- Do NOT offer options like "start processing" or "run extraction" — the UI handles this.
- If the user asks to process/extract/run, remind them to scroll down and click the "Run Preview" button in the capabilities section below.
- If the user wants to change capabilities, help them adjust selections.
- Do NOT call recommend_capabilities again — it has already been called.

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
${CAPABILITIES.join(', ')}

METHOD FAMILY HINTS (inform the user when proposing these capabilities):
- Amazon Bedrock Guardrails is the preferred engine for pii_detection and pii_redaction on English documents: deterministic rules, no LLM hallucination, very low cost. When PII is a user goal, mention Guardrails as the default choice for those steps and explain that other extraction capabilities (summary, KV, tables) run on LLM/BDA methods, then feed into Guardrails for a sequential redact stage.
- For non-English documents Guardrails is skipped automatically — Claude/Nova handles PII in that case.

RELEVANCE SCORING — BE STRICT:
- 0.90-1.0: CORE capabilities only (max 2-3). These directly perform what the user asked for.
- 0.75-0.89: Strong supporting capabilities that clearly add value.
- 0.50-0.74: Nice-to-have — shown but NOT auto-selected. Use this for preprocessing/postprocessing steps.
- Below 0.50: Do NOT include.

SCORING RULES:
- Reserve 0.90+ for the 1-3 capabilities that DIRECTLY answer the user's request.
- Preprocessing (OCR Enhancement, Format Standardization) and structural analysis (Layout Analysis, Bounding Box) are supporting — score 0.50-0.74 unless they are the PRIMARY goal.
- Avoid overlap: if Table Extraction covers the need, do NOT also score KV Extraction at 0.90.
- Fewer high-scoring capabilities = better. Be selective, not generous.

The scores are displayed in the UI as-is (e.g. 0.95 = 95%). Capabilities >= 0.75 are auto-selected.
Do NOT include <recommendation> tags — the tool handles the UI update automatically.`;
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
    maxTokens: 16384,
    temperature: 0.7,
  });

  // Convert history to MessageData[] for the Agent constructor
  const priorMessages = historyToMessageData(conversationHistory);

  // Create tools with bound document context (avoids LLM garbling Korean s3Uri)
  const tools = createTools(options);

  const agent = new Agent({
    model,
    tools,
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
    messageContent = `A document has been uploaded. ${userMessage}\n\nAnalyze the document using the analyze_document tool.`;
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

        // If recommend_capabilities was called, emit recommendation event with languages
        if (e.toolUse.name === 'recommend_capabilities' && resultText) {
          try {
            const parsed = JSON.parse(resultText);
            if (parsed.capabilities) {
              emitSSE(res, {
                type: 'recommendation',
                data: {
                  capabilities: parsed.capabilities as CapabilityRecommendation[],
                  documentLanguages: parsed.documentLanguages as string[] | undefined,
                },
              } as ConversationEvent);
            }
          } catch {
            // Parse failed
          }
        }
      }
    }

    // Recommendation is emitted via the tool result handler above — no need to parse from text
  } catch (err) {
    console.error('[Strands Socratic Agent Error]', err);
    emitSSE(res, {
      type: 'text',
      data: '\n\nI encountered an issue processing your request. Please try again.',
    } as ConversationEvent);
  }
}
