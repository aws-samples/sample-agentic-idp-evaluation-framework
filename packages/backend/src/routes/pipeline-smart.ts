import { Router } from 'express';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, config } from '../config/aws.js';
import { generatePipeline } from '../services/pipeline-generator.js';
import type { Capability, ProcessingMethod, PipelineGenerateRequest } from '@idp/shared';
import { CAPABILITY_SUPPORT, getBestMethodsForCapability, getMethodFamily } from '@idp/shared';

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

// ─── Rule-based fast path (skip Claude when confidence is high) ──────────────

function tryRuleBasedRouting(
  body: SmartPipelineRequest,
): { optimizeFor: string; enableHybridRouting: boolean; methodAssignments: Record<string, string>; rationale: string; estimatedSavings: string } | null {
  // Need preview results to determine confidence
  const validPreviews = (body.previewResults ?? []).filter((r) => !r.error);
  if (validPreviews.length === 0) return null;

  // Determine optimizeFor from preview data
  const optimizeFor = body.preferredMethod ? 'accuracy' : 'balanced';

  // For each capability, select the best method using existing rule-based logic
  const methodAssignments: Record<string, string> = {};
  const supportLevels: string[] = [];

  for (const cap of body.capabilities) {
    const candidates = getBestMethodsForCapability(cap);
    const bestMethod = candidates[0]; // Already sorted by support level
    methodAssignments[cap] = bestMethod;

    const family = getMethodFamily(bestMethod);
    const support = CAPABILITY_SUPPORT[family]?.[cap] ?? 'none';
    supportLevels.push(support);
  }

  // Calculate confidence: ratio of excellent/good support
  const goodCount = supportLevels.filter((s) => s === 'excellent' || s === 'good').length;
  const confidence = goodCount / supportLevels.length;

  if (confidence >= 0.7) {
    return {
      optimizeFor,
      enableHybridRouting: false,
      methodAssignments,
      rationale: `Rule-based routing (${(confidence * 100).toFixed(0)}% confidence): all capabilities have excellent/good support. Skipped LLM routing for faster response.`,
      estimatedSavings: 'Saved ~$0.01 by skipping LLM routing call',
    };
  }

  if (confidence >= 0.5) {
    return {
      optimizeFor,
      enableHybridRouting: false,
      methodAssignments,
      rationale: `Rule-based routing (${(confidence * 100).toFixed(0)}% confidence): most capabilities have good support, some may benefit from hybrid routing.`,
      estimatedSavings: 'Saved ~$0.01 by skipping LLM routing call',
    };
  }

  // Low confidence — fall through to Claude
  return null;
}

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as SmartPipelineRequest;

  if (!body.capabilities?.length) {
    res.status(400).json({ error: 'capabilities required' });
    return;
  }

  try {
    // Try rule-based fast path first (< 10ms, no AWS cost)
    const ruleBasedResult = tryRuleBasedRouting(body);
    if (ruleBasedResult) {
      const preferredMethods = Object.values(ruleBasedResult.methodAssignments) as ProcessingMethod[];
      const pipelineRequest: PipelineGenerateRequest = {
        documentType: (body.documentType ?? 'pdf') as any,
        capabilities: body.capabilities,
        optimizeFor: (ruleBasedResult.optimizeFor ?? 'balanced') as any,
        enableHybridRouting: ruleBasedResult.enableHybridRouting,
        preferredMethods: preferredMethods.length > 0 ? preferredMethods : undefined,
      };
      const result = generatePipeline(pipelineRequest);
      res.json({
        ...result,
        smartRecommendation: {
          ...ruleBasedResult,
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
        },
      });
      return;
    }

    // Build a summary of preview results for Claude
    const previewSummary = (body.previewResults ?? [])
      .filter((r) => !r.error && r.status !== 'error')
      .map((r) => {
        const capCount = Object.keys(r.results).length;
        const costStr = r.estimatedCost != null
          ? `$${r.estimatedCost.toFixed(4)}`
          : r.actualCost?.totalCost != null
            ? `$${r.actualCost.totalCost.toFixed(6)}`
            : 'N/A';
        const confStr = r.confidence != null ? `${Math.round(r.confidence * 100)}% avg confidence` : '';

        return `- ${r.shortName} (${r.family ?? 'unknown'}): ${capCount} capabilities extracted, ${r.latencyMs}ms latency, ${costStr} cost${confStr ? `, ${confStr}` : ''}`;
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
