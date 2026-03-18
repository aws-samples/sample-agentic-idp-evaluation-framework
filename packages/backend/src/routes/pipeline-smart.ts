import { Router } from 'express';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, config } from '../config/aws.js';
import { generatePipeline } from '../services/pipeline-generator.js';
import type { Capability, ProcessingMethod, PipelineGenerateRequest } from '@idp/shared';

interface SmartPipelineRequest {
  capabilities: Capability[];
  documentType: string;
  previewResults: {
    method: string;
    shortName: string;
    results: Record<string, unknown>;
    latencyMs: number;
    tokenUsage?: { inputTokens: number; outputTokens: number };
    actualCost?: { totalCost: number };
    error?: string;
  }[];
  preferredMethod?: string;
}

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as SmartPipelineRequest;

  if (!body.capabilities?.length) {
    res.status(400).json({ error: 'capabilities required' });
    return;
  }

  try {
    // Build a summary of preview results for Claude
    const previewSummary = (body.previewResults ?? [])
      .filter((r) => !r.error)
      .map((r) => {
        const parsed = r.results as Record<string, unknown>;
        const extractions = (parsed?.extractions ?? {}) as Record<string, { found?: boolean; confidence?: number }>;
        const found = Object.values(extractions).filter((e) => e?.found).length;
        const total = Object.keys(extractions).length;

        return `- ${r.shortName}: ${found}/${total} fields found, ${r.latencyMs}ms latency, $${r.actualCost?.totalCost?.toFixed(6) ?? 'N/A'} cost, ${r.tokenUsage ? `${r.tokenUsage.inputTokens}+${r.tokenUsage.outputTokens} tokens` : 'N/A'}`;
      })
      .join('\n');

    const prompt = `You are an IDP pipeline architect. Analyze these extraction preview results and recommend the optimal pipeline configuration.

Document type: ${body.documentType ?? 'unknown'}
Selected capabilities: ${body.capabilities.join(', ')}
${body.preferredMethod ? `User preferred method: ${body.preferredMethod}` : ''}

Preview results from 3 methods:
${previewSummary || 'No preview results available.'}

Available methods:
- claude-sonnet: Claude Sonnet 4.6 ($3/$15 per 1M tokens) - highest accuracy
- claude-haiku: Claude Haiku 4.5 ($1/$5 per 1M tokens) - fast and cheap
- claude-opus: Claude Opus 4.6 ($5/$25 per 1M tokens) - most capable
- nova-lite: Nova 2 Lite ($0.30/$2.50 per 1M tokens) - cheapest LLM
- nova-pro: Nova 2 Pro ($1.25/$10 per 1M tokens) - balanced
- bda-standard: BDA Standard ($0.01/page) - automated extraction
- bda-custom: BDA Custom ($0.04/page) - custom blueprints
- textract-claude-sonnet: Textract+Sonnet ($0.0015/pg + LLM tokens)
- textract-claude-haiku: Textract+Haiku ($0.0015/pg + LLM tokens)
- textract-nova-lite: Textract+Nova Lite ($0.0015/pg + LLM tokens)

Return ONLY valid JSON:
{
  "optimizeFor": "accuracy" | "cost" | "speed" | "balanced",
  "enableHybridRouting": true/false,
  "methodAssignments": {
    "<capability>": "<method_id>"
  },
  "rationale": "2-3 sentence explanation of why this configuration",
  "estimatedSavings": "compared to using the most expensive method for everything"
}

Be practical. Consider:
1. Which method actually extracted the most fields successfully in the preview
2. Cost vs accuracy tradeoff
3. Whether hybrid routing adds value for this document type
4. Group capabilities that can share the same method`;

    const command = new ConverseCommand({
      modelId: config.claudeModelId,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 2048, temperature: 0.2 },
    });

    const response = await bedrockClient.send(command);
    const rawText = response.output?.message?.content?.[0]?.text ?? '';

    // Parse Claude's recommendation
    let recommendation: {
      optimizeFor: string;
      enableHybridRouting: boolean;
      methodAssignments: Record<string, string>;
      rationale: string;
      estimatedSavings: string;
    };

    try {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
      recommendation = JSON.parse(jsonMatch?.[1] ?? rawText);
    } catch {
      // Fallback: use balanced defaults
      recommendation = {
        optimizeFor: 'balanced',
        enableHybridRouting: false,
        methodAssignments: {},
        rationale: rawText,
        estimatedSavings: 'N/A',
      };
    }

    // Build preferred methods list from Claude's assignments
    const preferredMethods = Object.values(recommendation.methodAssignments) as ProcessingMethod[];

    // Generate pipeline using the standard generator but with Claude's preferences
    const pipelineRequest: PipelineGenerateRequest = {
      documentType: (body.documentType ?? 'pdf') as any,
      capabilities: body.capabilities,
      optimizeFor: (recommendation.optimizeFor ?? 'balanced') as any,
      enableHybridRouting: recommendation.enableHybridRouting ?? false,
      preferredMethods: preferredMethods.length > 0 ? preferredMethods : undefined,
    };

    const result = generatePipeline(pipelineRequest);

    // Add Claude's rationale and token usage
    const tokenUsage = response.usage;

    res.json({
      ...result,
      smartRecommendation: {
        ...recommendation,
        tokenUsage: {
          inputTokens: tokenUsage?.inputTokens ?? 0,
          outputTokens: tokenUsage?.outputTokens ?? 0,
        },
      },
    });
  } catch (err) {
    console.error('[Smart Pipeline Error]', err);

    // Fallback to standard generation
    try {
      const fallbackRequest: PipelineGenerateRequest = {
        documentType: (body.documentType ?? 'pdf') as any,
        capabilities: body.capabilities,
        optimizeFor: 'balanced',
        enableHybridRouting: false,
      };
      const result = generatePipeline(fallbackRequest);
      res.json({
        ...result,
        smartRecommendation: {
          optimizeFor: 'balanced',
          enableHybridRouting: false,
          methodAssignments: {},
          rationale: 'Fallback to rule-based generation (LLM unavailable).',
          estimatedSavings: 'N/A',
        },
      });
    } catch (fallbackErr) {
      res.status(500).json({ error: 'Failed to generate pipeline' });
    }
  }
});

export default router;
