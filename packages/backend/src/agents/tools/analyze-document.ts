import { ConverseCommand, type Message } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, config } from '../../config/aws.js';
import { getDocumentBuffer } from '../../services/s3.js';

export interface DocumentAnalysis {
  documentType: string;
  pageCount: number;
  hasTablesDetected: boolean;
  hasFormsDetected: boolean;
  hasImagesDetected: boolean;
  hasHandwriting: boolean;
  languages: string[];
  summary: string;
}

export async function analyzeDocument(
  documentId: string,
  s3Uri: string,
): Promise<DocumentAnalysis> {
  try {
    const docBuffer = await getDocumentBuffer(s3Uri);

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            document: {
              name: 'document',
              format: 'pdf',
              source: { bytes: docBuffer },
            },
          },
          {
            text: `Analyze this document and return a JSON object with the following fields:
- documentType: string (e.g., "invoice", "contract", "medical_record", "form", "report")
- pageCount: number (estimated)
- hasTablesDetected: boolean
- hasFormsDetected: boolean
- hasImagesDetected: boolean
- hasHandwriting: boolean
- languages: string[] (detected languages)
- summary: string (brief 1-2 sentence summary)

Return ONLY valid JSON, no markdown.`,
          },
        ],
      },
    ];

    const command = new ConverseCommand({
      modelId: config.claudeModelId,
      system: [{ text: 'You are a document analysis assistant. Return only valid JSON.' }],
      messages,
      inferenceConfig: {
        maxTokens: 1024,
        temperature: 0,
      },
    });

    const response = await bedrockClient.send(command);
    const text = response.output?.message?.content?.[0]?.text ?? '{}';

    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '');
    return JSON.parse(cleaned) as DocumentAnalysis;
  } catch (err) {
    console.error('[analyzeDocument Error]', err);
    return {
      documentType: 'unknown',
      pageCount: 1,
      hasTablesDetected: false,
      hasFormsDetected: false,
      hasImagesDetected: false,
      hasHandwriting: false,
      languages: ['en'],
      summary: 'Unable to analyze document',
    };
  }
}
