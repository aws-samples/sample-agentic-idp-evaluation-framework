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
  optimizeFor?: 'accuracy' | 'cost' | 'speed' | 'balanced';
  documentLanguages?: string[];
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
    const allPreviews = body.previewResults ?? [];
    const validPreviews = allPreviews.filter((r) => !r.error && r.status !== 'error');
    const failedPreviews = allPreviews.filter((r) => r.error || r.status === 'error');

    const previewSummary = validPreviews.length > 0
      ? validPreviews.map((r) => {
          const costStr = r.estimatedCost != null
            ? `$${r.estimatedCost.toFixed(4)}`
            : r.actualCost?.totalCost != null
              ? `$${r.actualCost.totalCost.toFixed(6)}`
              : 'N/A';
          const confStr = r.confidence != null ? `${Math.round(r.confidence * 100)}% avg` : '';
          // Per-capability confidence breakdown
          const capDetails = Object.entries(r.results as Record<string, any>)
            .map(([cap, val]) => {
              const conf = val?.confidence != null ? `${Math.round(val.confidence * 100)}%` : '?';
              return `${cap}=${conf}`;
            })
            .join(', ');
          return `- ${r.method} (${r.shortName}, ${r.family ?? 'unknown'}): ${r.latencyMs}ms, ${costStr}, ${confStr} [${capDetails}]`;
        }).join('\n')
        + (failedPreviews.length > 0
          ? '\n\nFailed methods (DO NOT use):\n' + failedPreviews.map((r) => `- ${r.method}: ${r.error}`).join('\n')
          : '')
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

    const prompt = `You are an IDP pipeline architect. Your job: analyze ACTUAL preview results and build the single best pipeline.

Document type: ${body.documentType ?? 'unknown'}
Selected capabilities: ${body.capabilities.join(', ')}
${body.preferredMethod ? `User preferred method: ${body.preferredMethod}. Use this if its performance is competitive.` : ''}

PREVIEW RESULTS (actual measured performance):
${previewSummary}

${supportRef}

Available methods (${METHODS.length} total):
${methodListStr}

DECISION RULES:
1. USE THE ACTUAL PREVIEW DATA. The confidence scores, latency, and costs above are real measurements.
2. For each capability, pick the method that performed BEST in preview (highest confidence).
3. If two methods have similar confidence (within 5%), prefer the cheaper/faster one.
4. Group capabilities onto the same method when possible to avoid running multiple methods.
5. If a method failed or produced garbage output (confidence < 30%), exclude it entirely.
6. BDA alone produces garbled output for non-Latin text — check if the preview confirms this.
7. Do NOT blindly pick "balanced" — pick what the DATA says is best.

Return ONLY valid JSON:
{
  "optimizeFor": "accuracy" | "cost" | "speed" | "balanced",
  "enableHybridRouting": true/false,
  "methodAssignments": {
    "<capability>": "<method_id>"
  },
  "rationale": "2-3 sentence explanation citing specific confidence/cost numbers from preview",
  "estimatedSavings": "compared to using the most expensive method for everything"
}`;

    const command = new ConverseCommand({
      modelId: config.claudeModelId,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 16384, temperature: 0.2 },
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
      documentLanguages: body.documentLanguages,
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
