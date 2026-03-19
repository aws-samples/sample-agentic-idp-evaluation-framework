import { Router } from 'express';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, config } from '../config/aws.js';
import { generatePipeline } from '../services/pipeline-generator.js';
import type { Capability, ProcessingMethod, PipelineGenerateRequest } from '@idp/shared';
import { CAPABILITY_SUPPORT, METHODS, METHOD_INFO, METHOD_FAMILIES } from '@idp/shared';

interface PreviewMethodResult {
  method: string;
  shortName: string;
  family?: string;
  status?: 'complete' | 'error';
  results: Record<string, unknown>;
  latencyMs: number;
  estimatedCost?: number;
  confidence?: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  actualCost?: { totalCost: number };
  error?: string;
}

interface SmartPipelineRequest {
  capabilities: Capability[];
  documentType: string;
  previewResults: PreviewMethodResult[];
  preferredMethod?: string;
}

// Build capability support reference for the LLM prompt
function buildCapabilitySupportRef(capabilities: Capability[]): string {
  const lines: string[] = ['Capability support levels (reference data — use your judgment):'];
  for (const cap of capabilities) {
    const supports = METHOD_FAMILIES
      .map((f) => {
        const level = CAPABILITY_SUPPORT[f]?.[cap] ?? 'none';
        return level !== 'none' ? `${f}=${level}` : null;
      })
      .filter(Boolean);
    lines.push(`  ${cap}: ${supports.join(', ')}`);
  }
  return lines.join('\n');
}

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as SmartPipelineRequest;

  if (!body.capabilities?.length) {
    res.status(400).json({ error: 'capabilities required' });
    return;
  }

  try {
    // Build preview results summary (if available)
    const validPreviews = (body.previewResults ?? []).filter((r) => !r.error && r.status !== 'error');
    const previewSummary = validPreviews.length > 0
      ? validPreviews.map((r) => {
          const capCount = Object.keys(r.results).length;
          const costStr = r.estimatedCost != null
            ? `$${r.estimatedCost.toFixed(4)}`
            : r.actualCost?.totalCost != null
              ? `$${r.actualCost.totalCost.toFixed(6)}`
              : 'N/A';
          const confStr = r.confidence != null ? `${Math.round(r.confidence * 100)}% avg confidence` : '';
          return `- ${r.shortName} (${r.family ?? 'unknown'}): ${capCount} capabilities extracted, ${r.latencyMs}ms latency, ${costStr} cost${confStr ? `, ${confStr}` : ''}`;
        }).join('\n')
      : 'No preview results available. Decide based on capability support levels and method characteristics.';

    // Build method list dynamically from METHOD_INFO
    const methodListStr = METHODS.map((m) => {
      const info = METHOD_INFO[m];
      const pricing = info.family === 'bda'
        ? `$${info.estimatedCostPerPage}/page`
        : info.family === 'bda-llm'
          ? `BDA $0.01/pg + $${info.tokenPricing.inputPer1MTokens}/$${info.tokenPricing.outputPer1MTokens} per 1M tokens`
          : info.family === 'textract-llm'
            ? `Textract $0.0015/pg + $${info.tokenPricing.inputPer1MTokens}/$${info.tokenPricing.outputPer1MTokens} per 1M tokens`
            : `$${info.tokenPricing.inputPer1MTokens}/$${info.tokenPricing.outputPer1MTokens} per 1M tokens`;
      return `- ${m}: ${info.name} (${pricing}) - ${info.strengths[0] ?? info.description}`;
    }).join('\n');

    // Build capability support reference
    const supportRef = buildCapabilitySupportRef(body.capabilities);

    const prompt = `You are an IDP pipeline architect. Analyze the data below and recommend the optimal pipeline configuration.

Document type: ${body.documentType ?? 'unknown'}
Selected capabilities: ${body.capabilities.join(', ')}
${body.preferredMethod ? `User preferred method: ${body.preferredMethod}` : ''}

Preview results:
${previewSummary}

${supportRef}

Available methods (${METHODS.length} total):
${methodListStr}

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
1. If preview results exist, prioritize methods with highest actual confidence scores
2. Cost vs accuracy tradeoff — cheaper methods are preferred when quality is similar
3. Whether hybrid routing (different methods per capability) adds value
4. Group capabilities that can share the same method to reduce cost
5. BDA alone cannot do KV extraction well — use BDA+LLM or direct LLM for structured extraction`;

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
      recommendation = {
        optimizeFor: 'balanced',
        enableHybridRouting: false,
        methodAssignments: {},
        rationale: rawText,
        estimatedSavings: 'N/A',
      };
    }

    // Generate pipeline using the standard generator with LLM's preferences
    const preferredMethods = Object.values(recommendation.methodAssignments) as ProcessingMethod[];

    const pipelineRequest: PipelineGenerateRequest = {
      documentType: (body.documentType ?? 'pdf') as any,
      capabilities: body.capabilities,
      optimizeFor: (recommendation.optimizeFor ?? 'balanced') as any,
      enableHybridRouting: recommendation.enableHybridRouting ?? false,
      preferredMethods: preferredMethods.length > 0 ? preferredMethods : undefined,
    };

    const result = generatePipeline(pipelineRequest);
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

    // Fallback: generate pipeline without LLM recommendation
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
          rationale: 'LLM routing unavailable. Pipeline generated with default balanced optimization.',
          estimatedSavings: 'N/A',
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to generate pipeline' });
    }
  }
});

export default router;
