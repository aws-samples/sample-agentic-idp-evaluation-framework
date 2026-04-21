import { Router } from 'express';
import { ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, config } from '../config/aws.js';
import { generatePipeline } from '../services/pipeline-generator.js';
import { initSSE, emitSSE, startKeepalive, endSSE } from '../services/streaming.js';
import type { Capability, ProcessingMethod, PipelineDefinition, PipelineGenerateRequest } from '@idp/shared';
import { METHODS, METHOD_INFO, CAPABILITY_SUPPORT, METHOD_FAMILIES, CAPABILITIES } from '@idp/shared';

interface PipelineChatRequest {
  message: string;
  history: Array<{ role: string; content: string }>;
  currentPipeline: PipelineDefinition;
  capabilities: Capability[];
  documentType: string;
  documentLanguages?: string[];
}

const router = Router();

router.post('/', async (req, res) => {
  const body = req.body as PipelineChatRequest;

  if (!body.message || !body.currentPipeline || !body.capabilities?.length) {
    res.status(400).json({ error: 'message, currentPipeline, and capabilities are required' });
    return;
  }

  initSSE(res);
  const keepalive = startKeepalive(res);

  try {
    // Build current pipeline description for Claude
    const methodNodes = body.currentPipeline.nodes.filter((n) => n.type === 'method');
    const currentConfig = methodNodes.map((n) => {
      const cfg = n.config as { method?: string; capabilities?: string[] };
      const info = cfg.method ? METHOD_INFO[cfg.method as ProcessingMethod] : null;
      return `- ${info?.shortName ?? n.label}: handles ${(cfg.capabilities ?? []).join(', ')}`;
    }).join('\n');

    // Build available methods reference
    const methodListStr = METHODS.map((m) => {
      const info = METHOD_INFO[m];
      const pricing = info.family === 'bda'
        ? `$${info.estimatedCostPerPage}/page`
        : info.family === 'bda-llm'
          ? `BDA + $${info.tokenPricing.inputPer1MTokens}/$${info.tokenPricing.outputPer1MTokens}/1M tokens`
          : info.family === 'textract-llm'
            ? `Textract + $${info.tokenPricing.inputPer1MTokens}/$${info.tokenPricing.outputPer1MTokens}/1M tokens`
            : `$${info.tokenPricing.inputPer1MTokens}/$${info.tokenPricing.outputPer1MTokens}/1M tokens`;
      return `- ${m} (${info.shortName}): ${pricing}`;
    }).join('\n');

    // Build capability support reference
    const supportRef = body.capabilities.map((cap) => {
      const supports = METHOD_FAMILIES
        .map((f) => {
          const level = CAPABILITY_SUPPORT[f]?.[cap] ?? 'none';
          return level !== 'none' ? `${f}=${level}` : null;
        })
        .filter(Boolean);
      return `  ${cap}: ${supports.join(', ')}`;
    }).join('\n');

    const allCapabilitiesStr = CAPABILITIES.join(', ');

    const systemPrompt = `You are a pipeline architect assistant. The user has an IDP (Intelligent Document Processing) pipeline and wants to modify it through conversation.

CURRENT PIPELINE:
- Name: ${body.currentPipeline.name}
- Est. Cost: $${body.currentPipeline.estimatedCostPerPage.toFixed(4)}/page
- Est. Latency: ${body.currentPipeline.estimatedLatencyMs}ms
- Methods in use:
${currentConfig}

CURRENT CAPABILITIES: ${body.capabilities.join(', ')}
DOCUMENT TYPE: ${body.documentType ?? 'pdf'}

ALL SUPPORTED CAPABILITIES (user can ask to add/remove any of these):
${allCapabilitiesStr}

AVAILABLE METHODS:
${methodListStr}

CAPABILITY SUPPORT:
${supportRef}

RULES:
1. Respond conversationally — explain what you're changing and why.
2. When modifying the pipeline, wrap your changes in <pipeline_update> tags with this JSON:
   <pipeline_update>{"optimizeFor":"balanced","enableHybridRouting":false,"capabilities":["cap-id-1","cap-id-2"],"methodAssignments":{"cap-id-1":"method-id","cap-id-2":"method-id"}}</pipeline_update>
   - \`capabilities\` (OPTIONAL): list the final set of capabilities the pipeline should run. Use exact IDs from ALL SUPPORTED CAPABILITIES. Omit to keep the current set.
     - To ADD a capability: include it alongside the existing ones.
     - To REMOVE a capability: list the remaining ones without it.
   - \`methodAssignments\` must include EVERY capability in the final set (current or updated). Only use method IDs from AVAILABLE METHODS.
   - To create MULTIPLE method nodes in the pipeline graph, assign DIFFERENT method IDs across capabilities (e.g. {"text_extraction":"claude-sonnet","table_extraction":"textract-claude-sonnet"}). The graph collapses any two capabilities that share the same method into a single node.
3. If the user asks a question that doesn't require pipeline changes, just answer without <pipeline_update> tags.
4. After your response, suggest 2-3 follow-up actions in <options> tags:
   <options>["Optimize for cost", "Optimize for accuracy", "Use fastest methods"]</options>
5. Keep responses concise (2-4 sentences + the tags).`;

    // Build conversation history for Claude
    const messages = body.history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10) // Keep last 10 messages for context
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: [{ text: m.content }],
      }));

    // Add current user message
    messages.push({
      role: 'user',
      content: [{ text: body.message }],
    });

    const command = new ConverseStreamCommand({
      modelId: config.claudeModelId,
      system: [{ text: systemPrompt }],
      messages,
      inferenceConfig: { maxTokens: 4096, temperature: 0.3 },
    });

    const response = await bedrockClient.send(command);
    let fullText = '';

    if (response.stream) {
      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          const chunk = event.contentBlockDelta.delta.text;
          fullText += chunk;
          emitSSE(res, { type: 'text', data: chunk });
        }
      }
    }

    // Extract and process pipeline update if present
    const updateMatch = fullText.match(/<pipeline_update>([\s\S]*?)<\/pipeline_update>/);
    if (updateMatch) {
      try {
        const update = JSON.parse(updateMatch[1]) as {
          optimizeFor?: string;
          enableHybridRouting?: boolean;
          capabilities?: string[];
          methodAssignments?: Record<string, string>;
        };

        // Resolve final capability set. If the LLM supplied a capabilities list,
        // filter to known IDs; otherwise keep the current set.
        const requestedCaps = Array.isArray(update.capabilities)
          ? update.capabilities.filter((c): c is Capability => CAPABILITIES.includes(c as Capability))
          : null;
        const finalCapabilities: Capability[] =
          requestedCaps && requestedCaps.length > 0 ? requestedCaps : body.capabilities;

        // Validate method IDs and restrict to capabilities in the final set.
        const validAssignments: Record<string, ProcessingMethod> = {};
        if (update.methodAssignments) {
          for (const [cap, method] of Object.entries(update.methodAssignments)) {
            if (!finalCapabilities.includes(cap as Capability)) continue;
            if (METHODS.includes(method as ProcessingMethod)) {
              validAssignments[cap] = method as ProcessingMethod;
            }
          }
        }

        // Pass assignments verbatim to the generator so DIFFERENT capabilities
        // with DIFFERENT methods create multiple method nodes.
        const pipelineRequest: PipelineGenerateRequest = {
          documentType: (body.documentType ?? 'pdf') as any,
          capabilities: finalCapabilities,
          optimizeFor: (update.optimizeFor ?? 'balanced') as any,
          enableHybridRouting: update.enableHybridRouting ?? false,
          methodAssignments: Object.keys(validAssignments).length > 0 ? validAssignments : undefined,
          documentLanguages: body.documentLanguages,
        };

        const result = generatePipeline(pipelineRequest);
        emitSSE(res, {
          type: 'pipeline_update',
          data: { pipeline: result.pipeline, alternatives: result.alternatives },
        });
      } catch (err) {
        console.error('[Pipeline Chat] Failed to parse pipeline update:', err);
      }
    }

    emitSSE(res, { type: 'done' });
    endSSE(res, keepalive);
  } catch (err) {
    console.error('[Pipeline Chat Error]', err);
    emitSSE(res, { type: 'text', data: '\n\nSorry, I encountered an error. Please try again.' });
    emitSSE(res, { type: 'done' });
    endSSE(res, keepalive);
  }
});

export default router;
