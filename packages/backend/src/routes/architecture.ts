import { Router } from 'express';
import type { ArchitectureRequest, ArchitectureEvent } from '@idp/shared';
import { ConverseStreamCommand, type Message } from '@aws-sdk/client-bedrock-runtime';
import { METHODS, METHOD_INFO } from '@idp/shared';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';
import { bedrockClient, config } from '../config/aws.js';
import { estimateMonthlyCost } from '../services/pricing.js';

const ARCHITECT_SYSTEM_PROMPT = `You are an AWS Solutions Architect specializing in Intelligent Document Processing (IDP). Based on the processing results and comparison data provided, create an architecture recommendation.

Your response MUST include:

1. **Architecture Overview**: A text explanation of the recommended architecture, including which AWS services to use and why.

2. **Architecture Diagram**: A Mermaid diagram showing the complete architecture. Wrap it in <diagram> tags:
<diagram>
graph TD
    A[Document Upload] --> B[S3 Bucket]
    B --> C[Processing Pipeline]
    ...
</diagram>

3. **Cost Projections**: Monthly cost estimates at different scales. Wrap in <costs> tags:
<costs>
{"scale": "small", "docsPerMonth": 1000, "methods": [{"method": "bda-standard", "monthlyCost": 10}]}
</costs>
<costs>
{"scale": "medium", "docsPerMonth": 10000, "methods": [{"method": "bda-standard", "monthlyCost": 100}]}
</costs>
<costs>
{"scale": "large", "docsPerMonth": 100000, "methods": [{"method": "bda-standard", "monthlyCost": 1000}]}
</costs>

Be specific about AWS services, include error handling and monitoring recommendations.`;

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as ArchitectureRequest;

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    // Guard: skip AI generation if no processing data
    if (!body.processingResults?.length) {
      emitSSE(res, { type: 'text', data: 'No processing results available. Run the pipeline first to get AI-powered architecture recommendations.' } as ArchitectureEvent);
      emitSSE(res, { type: 'done' } as ArchitectureEvent);
      endSSE(res, keepalive);
      return;
    }

    const contextSummary = JSON.stringify({
      capabilities: body.capabilities,
      comparison: body.comparison ?? { methods: [], recommendation: 'N/A', capabilityMatrix: {} },
      processingResults: body.processingResults.map((r) => ({
        method: r.method,
        status: r.status,
        metrics: r.metrics,
      })),
      availableMethods: METHODS.map((m) => ({
        id: m,
        name: METHOD_INFO[m].name,
        estimatedCostPerPage: METHOD_INFO[m].estimatedCostPerPage,
      })),
    }, null, 2);

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          {
            text: `Based on the following processing results and comparison, provide an architecture recommendation:\n\n${contextSummary}`,
          },
        ],
      },
    ];

    const command = new ConverseStreamCommand({
      modelId: config.claudeModelId,
      system: [{ text: ARCHITECT_SYSTEM_PROMPT }],
      messages,
      inferenceConfig: {
        maxTokens: 32768,
        temperature: 0.3,
      },
    });

    const response = await bedrockClient.send(command);

    let fullText = '';

    if (response.stream) {
      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          const chunk = event.contentBlockDelta.delta.text;
          fullText += chunk;

          const textEvent: ArchitectureEvent = { type: 'text', data: chunk };
          emitSSE(res, textEvent);
        }
      }
    }

    // Extract diagram
    const diagramMatch = fullText.match(/<diagram>([\s\S]*?)<\/diagram>/);
    if (diagramMatch) {
      const diagramEvent: ArchitectureEvent = {
        type: 'diagram',
        data: diagramMatch[1].trim(),
      };
      emitSSE(res, diagramEvent);
    }

    // Extract cost projections
    const costMatches = fullText.matchAll(/<costs>([\s\S]*?)<\/costs>/g);
    for (const match of costMatches) {
      try {
        const costData = JSON.parse(match[1]);

        // Enhance with actual calculated costs
        if (costData.docsPerMonth) {
          const avgPages = 5;
          costData.methods = (body.comparison?.methods ?? []).map((m) => ({
            method: m.method,
            monthlyCost: estimateMonthlyCost(m.method, costData.docsPerMonth, avgPages),
          }));
        }

        const costEvent: ArchitectureEvent = {
          type: 'cost_projection',
          data: costData,
        };
        emitSSE(res, costEvent);
      } catch {
        // Cost parsing failed, skip
      }
    }

    const doneEvent: ArchitectureEvent = { type: 'done' };
    emitSSE(res, doneEvent);
  } catch (err) {
    console.error('[Architecture Error]', err);
    emitSSE(res, {
      type: 'text',
      data: 'Failed to generate architecture recommendation. Please try again.',
    });
    emitSSE(res, { type: 'done' });
  } finally {
    endSSE(res, keepalive);
  }
});

export default router;
