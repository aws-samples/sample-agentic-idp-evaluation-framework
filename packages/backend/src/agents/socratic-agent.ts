import {
  ConverseStreamCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { Response } from 'express';
import type { ConversationEvent, CapabilityRecommendation } from '@idp/shared';
import { CAPABILITY_INFO, CAPABILITY_CATEGORIES, CATEGORY_INFO, getCapabilitiesByCategory } from '@idp/shared';
import { bedrockClient, config } from '../config/aws.js';
import { emitSSE } from '../services/streaming.js';
import { analyzeDocument } from './tools/analyze-document.js';

// Build capability list dynamically from CAPABILITY_INFO (SSOT: skill .md files)
function buildCapabilityList(): string {
  return CAPABILITY_CATEGORIES.map((catId) => {
    const catInfo = CATEGORY_INFO[catId];
    const caps = getCapabilitiesByCategory(catId);
    if (caps.length === 0) return '';
    const items = caps.map((c) => `- ${c.id}: ${c.description}`).join('\n');
    return `**${catInfo.name}:**\n${items}`;
  }).filter(Boolean).join('\n\n');
}

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

${buildCapabilityList()}

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
      maxTokens: 16384,
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

}
