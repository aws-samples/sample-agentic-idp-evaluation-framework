import type { Response } from 'express';
import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import {
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { StreamAdapter, AdapterInput, AdapterOutput } from './stream-adapter.js';
import { emitProgress } from './stream-adapter.js';
import { bedrockClient } from '../config/aws.js';

function buildSystemPrompt(capabilities: string[]): string {
  return `You are a document processing AI. Extract the following capabilities from the provided document:
${capabilities.map((c) => `- ${c}`).join('\n')}

Return your results as a JSON object with each capability as a key. For each capability, provide:
- "data": the extracted content
- "confidence": a number between 0 and 1 indicating your confidence
- "format": one of "html", "csv", "json", "text"

For table_extraction, use HTML table format.
For kv_extraction, use JSON key-value pairs.
For image_description, provide text descriptions.
For bounding_box, provide JSON with coordinates.
For text_extraction, provide plain text.

Return ONLY valid JSON, no markdown code blocks.`;
}

export class TokenStreamAdapter implements StreamAdapter {
  constructor(public readonly method: ProcessingMethod) {}

  private get modelId(): string {
    return METHOD_INFO[this.method].modelId;
  }

  async run(res: Response, input: AdapterInput): Promise<AdapterOutput> {
    const start = Date.now();

    emitProgress(res, this.method, 'all', 0, 'Sending document to model...');

    const documentContent: ContentBlock = {
      document: {
        name: 'document',
        format: 'pdf',
        source: {
          bytes: input.documentBuffer,
        },
      },
    };

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          documentContent,
          { text: `Process this document and extract: ${input.capabilities.join(', ')}` },
        ],
      },
    ];

    const command = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: buildSystemPrompt(input.capabilities) }],
      messages,
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0,
      },
    });

    const response = await bedrockClient.send(command);

    let fullText = '';
    let tokenCount = 0;

    if (response.stream) {
      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          const chunk = event.contentBlockDelta.delta.text;
          fullText += chunk;
          tokenCount++;

          const progress = Math.min(Math.floor((tokenCount / 100) * 90), 90);
          emitProgress(res, this.method, 'all', progress, chunk);
        }
      }
    }

    emitProgress(res, this.method, 'all', 100, 'Complete');

    const results = this.parseResults(fullText, input.capabilities);

    return {
      results,
      rawOutput: fullText,
      latencyMs: Date.now() - start,
    };
  }

  private parseResults(
    rawOutput: string,
    capabilities: string[],
  ): Record<string, { capability: string; data: unknown; confidence: number; format: string }> {
    const results: Record<string, { capability: string; data: unknown; confidence: number; format: string }> = {};

    let parsed: Record<string, unknown>;
    try {
      // Strip markdown code fences if present
      const cleaned = rawOutput.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '');
      parsed = JSON.parse(cleaned);
    } catch {
      for (const cap of capabilities) {
        results[cap] = {
          capability: cap,
          data: rawOutput,
          confidence: 0.5,
          format: 'text',
        };
      }
      return results;
    }

    for (const cap of capabilities) {
      const capData = parsed[cap] as Record<string, unknown> | undefined;
      if (capData && typeof capData === 'object' && 'data' in capData) {
        results[cap] = {
          capability: cap,
          data: capData.data,
          confidence: (capData.confidence as number) ?? 0.8,
          format: (capData.format as string) ?? 'json',
        };
      } else {
        results[cap] = {
          capability: cap,
          data: capData ?? rawOutput,
          confidence: 0.7,
          format: 'json',
        };
      }
    }

    return results;
  }
}
