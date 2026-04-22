/**
 * Extended edge-case coverage for generatePipeline beyond the happy-path tests.
 */
import { describe, it, expect } from 'vitest';
import type { PipelineGenerateRequest } from '@idp/shared';
import { generatePipeline } from '../services/pipeline-generator.js';

function mk(overrides: Partial<PipelineGenerateRequest> = {}): PipelineGenerateRequest {
  return {
    documentType: 'pdf',
    capabilities: [],
    optimizeFor: 'balanced',
    enableHybridRouting: false,
    ...overrides,
  };
}

describe('generatePipeline — edge cases', () => {
  it('single PII capability with no extraction stays on Guardrails (parallel, no composer)', () => {
    const { pipeline } = generatePipeline(mk({
      capabilities: ['pii_redaction'],
    }));
    const methods = pipeline.nodes
      .filter((n) => n.type === 'method')
      .map((n) => (n.config as any).method);
    // Should pick Guardrails (PII tie-breaker) — no composer, no aggregator.
    expect(methods).toContain('bedrock-guardrails');
    expect(pipeline.nodes.some((n) => n.type === 'sequential-composer')).toBe(false);
    expect(pipeline.nodes.some((n) => n.type === 'aggregator')).toBe(false);
  });

  it('multiple extract capabilities + PII on Guardrails all chain into the composer', () => {
    const { pipeline } = generatePipeline(mk({
      capabilities: ['document_summarization', 'kv_extraction', 'pii_redaction'],
      methodAssignments: {
        document_summarization: 'claude-sonnet',
        kv_extraction: 'claude-haiku',
        pii_redaction: 'bedrock-guardrails',
      },
    }));
    const composer = pipeline.nodes.find((n) => n.type === 'sequential-composer')!;
    const stages = (composer.config as any).stages as string[];
    expect(stages.length).toBe(3); // two extract + guardrails

    // Final stage must be the guardrails node.
    const guardrailsNode = pipeline.nodes.find((n) =>
      n.type === 'method' && (n.config as any).method === 'bedrock-guardrails',
    )!;
    expect(stages[stages.length - 1]).toBe(guardrailsNode.id);

    // Both extract stages must feed into guardrails.
    const extractNodes = pipeline.nodes.filter((n) =>
      n.type === 'method' && (n.config as any).method !== 'bedrock-guardrails',
    );
    expect(extractNodes.length).toBe(2);
    for (const extract of extractNodes) {
      expect(pipeline.edges.some((e) =>
        e.source === extract.id && e.target === guardrailsNode.id,
      )).toBe(true);
    }
  });

  it('honors preferredMethods filter over tie-breaker', () => {
    // User explicitly narrowed to Claude-only via preferredMethods.
    const { pipeline } = generatePipeline(mk({
      capabilities: ['pii_redaction'],
      preferredMethods: ['claude-sonnet'],
    }));
    const methods = pipeline.nodes
      .filter((n) => n.type === 'method')
      .map((n) => (n.config as any).method);
    expect(methods).toContain('claude-sonnet');
    expect(methods).not.toContain('bedrock-guardrails');
  });

  it('non-English + PII-only falls back to LLM (language filter removes guardrails)', () => {
    const { pipeline } = generatePipeline(mk({
      capabilities: ['pii_redaction'],
      documentLanguages: ['ko'],
    }));
    const methods = pipeline.nodes
      .filter((n) => n.type === 'method')
      .map((n) => (n.config as any).method);
    expect(methods).not.toContain('bedrock-guardrails');
  });

  it('keeps parallel + aggregator layout for 2 LLM caps with no PII', () => {
    const { pipeline } = generatePipeline(mk({
      capabilities: ['text_extraction', 'table_extraction'],
      methodAssignments: {
        text_extraction: 'claude-sonnet',
        table_extraction: 'claude-haiku',
      },
    }));
    const types = pipeline.nodes.map((n) => n.type);
    expect(types).toContain('aggregator');
    expect(types).not.toContain('sequential-composer');
  });

  it('pii_detection alone routes to Guardrails', () => {
    const { pipeline } = generatePipeline(mk({
      capabilities: ['pii_detection'],
    }));
    const methods = pipeline.nodes
      .filter((n) => n.type === 'method')
      .map((n) => (n.config as any).method);
    expect(methods).toContain('bedrock-guardrails');
  });

  it('generator output always has exactly one document-input and one pipeline-output node', () => {
    const configs: PipelineGenerateRequest[] = [
      mk({ capabilities: ['text_extraction'] }),
      mk({ capabilities: ['pii_redaction'] }),
      mk({
        capabilities: ['document_summarization', 'pii_redaction'],
        methodAssignments: {
          document_summarization: 'claude-sonnet',
          pii_redaction: 'bedrock-guardrails',
        },
      }),
      mk({
        capabilities: ['text_extraction', 'table_extraction', 'kv_extraction'],
        enableHybridRouting: true,
      }),
    ];
    for (const req of configs) {
      const { pipeline } = generatePipeline(req);
      const inputs = pipeline.nodes.filter((n) => n.type === 'document-input');
      const outputs = pipeline.nodes.filter((n) => n.type === 'pipeline-output');
      expect(inputs.length).toBe(1);
      expect(outputs.length).toBe(1);
    }
  });

  it('estimated cost includes every method used (no double-counting, no missing)', () => {
    const { pipeline } = generatePipeline(mk({
      capabilities: ['document_summarization', 'pii_redaction'],
      methodAssignments: {
        document_summarization: 'claude-sonnet',
        pii_redaction: 'bedrock-guardrails',
      },
    }));
    expect(pipeline.estimatedCostPerPage).toBeGreaterThan(0);
    // claude-sonnet ($0.015) + bedrock-guardrails ($0.0016) ≈ 0.0166
    expect(pipeline.estimatedCostPerPage).toBeCloseTo(0.015 + 0.0016, 3);
  });

  it('alternatives do not include the primary strategy', () => {
    const { pipeline, alternatives } = generatePipeline(mk({
      capabilities: ['text_extraction'],
      optimizeFor: 'accuracy',
    }));
    expect(pipeline.name.toLowerCase()).toContain('accuracy');
    for (const alt of alternatives) {
      expect(alt.name.toLowerCase()).not.toContain('accuracy');
    }
  });

  it('generator is deterministic for the same input (up to timestamps in IDs)', () => {
    const req = mk({
      capabilities: ['text_extraction', 'pii_redaction'],
      methodAssignments: {
        text_extraction: 'claude-sonnet',
        pii_redaction: 'bedrock-guardrails',
      },
    });
    const a = generatePipeline(req).pipeline;
    const b = generatePipeline(req).pipeline;
    // Same node types, same edge count.
    expect(a.nodes.map((n) => n.type).sort()).toEqual(b.nodes.map((n) => n.type).sort());
    expect(a.edges.length).toBe(b.edges.length);
  });
});
