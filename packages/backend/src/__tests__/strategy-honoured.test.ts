import { describe, it, expect, beforeAll } from 'vitest';
import type { PipelineGenerateRequest, ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import { generatePipeline } from '../services/pipeline-generator.js';

function req(overrides: Partial<PipelineGenerateRequest> = {}): PipelineGenerateRequest {
  return {
    documentType: 'pdf',
    capabilities: ['text_extraction'],
    optimizeFor: 'balanced',
    enableHybridRouting: false,
    ...overrides,
  };
}

function methodsOf(request: PipelineGenerateRequest): string[] {
  const { pipeline } = generatePipeline(request);
  return pipeline.nodes
    .filter((n) => n.type === 'method')
    .map((n) => (n.config as any).method as string);
}

/**
 * `selectMethod` used to `return candidates[0]` when none of the preferred
 * methods supported a capability. Candidates are ordered by support level, so a
 * request to optimize for cost or speed silently returned the most ACCURATE
 * method — the most expensive and slowest option, i.e. the opposite of the ask.
 */
describe('optimizeFor is honoured even when preferredMethods do not match', () => {
  // pii_redaction is supported by Guardrails and the LLM families, but not by a
  // Nova-only preference, so this is the fallback path.
  const capabilities = ['pii_redaction'] as PipelineGenerateRequest['capabilities'];
  const preferredMethods = ['nova-lite'] as PipelineGenerateRequest['preferredMethods'];

  it('cost strategy picks a cheaper method than accuracy strategy', () => {
    const costOf = (strategy: 'cost' | 'accuracy') => {
      const ms = methodsOf(req({ capabilities, preferredMethods, optimizeFor: strategy }));
      return ms.reduce((sum, m) => sum + (METHOD_INFO[m as never] as any).estimatedCostPerPage, 0);
    };
    expect(costOf('cost')).toBeLessThanOrEqual(costOf('accuracy'));
  });

  it('every strategy still produces a runnable pipeline on the fallback path', () => {
    for (const optimizeFor of ['balanced', 'accuracy', 'cost', 'speed'] as const) {
      const ms = methodsOf(req({ capabilities, preferredMethods, optimizeFor }));
      expect(ms.length, optimizeFor).toBeGreaterThan(0);
      for (const m of ms) expect(METHOD_INFO[m as never], `${optimizeFor}: ${m}`).toBeTruthy();
    }
  });
});

/**
 * The generator honours per-capability `methodAssignments`. /api/pipeline/smart
 * used to flatten the LLM's map into `preferredMethods`, which lost the mapping
 * and collapsed a deliberate multi-method plan onto one method.
 */
describe('per-capability methodAssignments produce a multi-method pipeline', () => {
  it('keeps each capability on its assigned method', () => {
    const { pipeline } = generatePipeline(req({
      capabilities: ['table_extraction', 'document_summarization'],
      methodAssignments: {
        table_extraction: 'textract-claude-haiku',
        document_summarization: 'claude-sonnet',
      },
    }));
    const byMethod = new Map<string, string[]>();
    for (const n of pipeline.nodes.filter((x) => x.type === 'method')) {
      byMethod.set((n.config as any).method, (n.config as any).capabilities);
    }
    expect(byMethod.get('textract-claude-haiku')).toEqual(['table_extraction']);
    expect(byMethod.get('claude-sonnet')).toEqual(['document_summarization']);
    // Two distinct methods means an aggregator is needed to resolve them.
    expect(pipeline.nodes.some((n) => n.type === 'aggregator')).toBe(true);
  });
});

/**
 * Audio/video can only be read by the managed BDA path. The generator only sees
 * `documentType`, so without an explicit media filter it selected a direct-LLM
 * method whose adapter then rejected the file. Verified live: an mp4 produced a
 * claude-haiku node that failed with "cannot read audio or video".
 */
describe('media documents route to methods that can actually read them', () => {
  it('routes AUDIO only to BDA', () => {
    // Converse has no audio content block, so every other family would be handed
    // a UTF-8 decode of the container.
    for (const optimizeFor of ['balanced', 'accuracy', 'cost', 'speed'] as const) {
      const ms = methodsOf(req({
        documentType: 'audio',
        capabilities: ['audio_transcription'],
        optimizeFor,
      }));
      expect(ms.length, optimizeFor).toBeGreaterThan(0);
      for (const m of ms) {
        expect(m.startsWith('bda-'), `audio/${optimizeFor} picked ${m}`).toBe(true);
      }
    }
  });

  it('routes VIDEO to BDA or a Converse-served multimodal LLM, never Textract/GPT', () => {
    // Converse has a native video block; Textract and GPT-via-Mantle do not.
    const VIDEO_OK = new Set(['claude', 'nova']);
    for (const optimizeFor of ['balanced', 'accuracy', 'cost', 'speed'] as const) {
      const ms = methodsOf(req({
        documentType: 'video',
        capabilities: ['video_summarization'],
        optimizeFor,
      }));
      expect(ms.length, optimizeFor).toBeGreaterThan(0);
      for (const m of ms) {
        const info = METHOD_INFO[m as ProcessingMethod] as { family: string } | undefined;
        const ok = m.startsWith('bda-') || (!!info && VIDEO_OK.has(info.family));
        expect(ok, `video/${optimizeFor} picked ${m}`).toBe(true);
      }
    }
  });

  it('still allows non-BDA methods for pdf', () => {
    const ms = methodsOf(req({ documentType: 'pdf', capabilities: ['text_extraction'] }));
    expect(ms.some((m) => !m.startsWith('bda-'))).toBe(true);
  });
});

/**
 * PII routing must not be a cost/speed trade-off.
 *
 * Only `balanced` consulted balancedScore, so the Guardrails specialist
 * preference applied to one of four strategies: `cost` routed pii_redaction to
 * Nova Lite and `speed` to Claude Haiku — asking a generative model to redact its
 * own output. A missed redaction is a data leak, not a saving.
 */
describe('PII always routes to the deterministic specialist when available', () => {
  const PII = ['pii_detection', 'pii_redaction'] as const;

  // The routing rule is conditional on Guardrails being configured, and vitest
  // loads the repo-root .env — so on a machine without BEDROCK_GUARDRAIL_ID these
  // assertions would pass for the wrong reason (Guardrails filtered out before
  // the rule is reached). State the precondition rather than assume it.
  beforeAll(() => {
    process.env.BEDROCK_GUARDRAIL_ID ||= 'test-guardrail';
  });

  it('picks Guardrails under every strategy', () => {
    for (const capability of PII) {
      for (const optimizeFor of ['balanced', 'accuracy', 'cost', 'speed'] as const) {
        const ms = methodsOf(req({ capabilities: [capability], optimizeFor }));
        expect(ms, `${capability}/${optimizeFor}`).toContain('bedrock-guardrails');
      }
    }
  });

  it('does not hand PII to a general LLM on the cheap/fast strategies', () => {
    for (const optimizeFor of ['cost', 'speed'] as const) {
      const ms = methodsOf(req({ capabilities: ['pii_redaction'], optimizeFor }));
      expect(ms).not.toContain('nova-lite');
      expect(ms).not.toContain('claude-haiku');
    }
  });

  it('leaves non-PII capabilities to the requested strategy', () => {
    // The override must be scoped to PII only.
    const cheap = methodsOf(req({ capabilities: ['text_extraction'], optimizeFor: 'cost' }));
    expect(cheap).not.toContain('bedrock-guardrails');
  });
});
