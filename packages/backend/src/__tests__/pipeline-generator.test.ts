import { describe, it, expect } from 'vitest';
import type { PipelineGenerateRequest } from '@idp/shared';
import { generatePipeline } from '../services/pipeline-generator.js';

function baseRequest(overrides: Partial<PipelineGenerateRequest> = {}): PipelineGenerateRequest {
  return {
    documentType: 'pdf',
    capabilities: [],
    optimizeFor: 'balanced',
    enableHybridRouting: false,
    ...overrides,
  };
}

describe('generatePipeline — parallel mode (default)', () => {
  it('emits input → method → output for a single capability', () => {
    const { pipeline } = generatePipeline(baseRequest({
      capabilities: ['text_extraction'],
    }));
    const types = pipeline.nodes.map((n) => n.type);
    expect(types).toContain('document-input');
    expect(types).toContain('method');
    expect(types).toContain('pipeline-output');
    expect(types).not.toContain('sequential-composer');
    expect(types).not.toContain('aggregator');
  });

  it('emits aggregator for multiple distinct methods', () => {
    const { pipeline } = generatePipeline(baseRequest({
      capabilities: ['text_extraction', 'video_summarization'],
    }));
    const types = pipeline.nodes.map((n) => n.type);
    expect(types).toContain('aggregator');
    expect(types).not.toContain('sequential-composer');
  });
});

describe('generatePipeline — sequential mode (Guardrails + extraction)', () => {
  it('emits sequential-composer when PII + extraction both selected', () => {
    const { pipeline } = generatePipeline(baseRequest({
      capabilities: ['document_summarization', 'pii_redaction'],
      methodAssignments: {
        document_summarization: 'claude-sonnet',
        pii_redaction: 'bedrock-guardrails',
      },
    }));
    const types = pipeline.nodes.map((n) => n.type);
    expect(types).toContain('sequential-composer');
    expect(types).not.toContain('aggregator');
  });

  it('sequential-composer stages include the extract stage node IDs followed by the guardrails stage node ID', () => {
    const { pipeline } = generatePipeline(baseRequest({
      capabilities: ['document_summarization', 'pii_redaction'],
      methodAssignments: {
        document_summarization: 'claude-sonnet',
        pii_redaction: 'bedrock-guardrails',
      },
    }));
    const composer = pipeline.nodes.find((n) => n.type === 'sequential-composer')!;
    const stages = (composer.config as any).stages as string[];
    expect(stages.length).toBe(2);
    const guardrailsNode = pipeline.nodes.find((n) =>
      n.type === 'method' && (n.config as any).method === 'bedrock-guardrails',
    )!;
    expect(stages[stages.length - 1]).toBe(guardrailsNode.id);
  });

  it('edges wire input → extract → guardrails → composer → output', () => {
    const { pipeline } = generatePipeline(baseRequest({
      capabilities: ['document_summarization', 'pii_redaction'],
      methodAssignments: {
        document_summarization: 'claude-sonnet',
        pii_redaction: 'bedrock-guardrails',
      },
    }));
    const inputNode = pipeline.nodes.find((n) => n.type === 'document-input')!;
    const guardrailsNode = pipeline.nodes.find((n) =>
      n.type === 'method' && (n.config as any).method === 'bedrock-guardrails',
    )!;
    const extractNode = pipeline.nodes.find((n) =>
      n.type === 'method' && (n.config as any).method === 'claude-sonnet',
    )!;
    const composerNode = pipeline.nodes.find((n) => n.type === 'sequential-composer')!;
    const outputNode = pipeline.nodes.find((n) => n.type === 'pipeline-output')!;

    // input → extract
    expect(pipeline.edges.some((e) => e.source === inputNode.id && e.target === extractNode.id)).toBe(true);
    // extract → guardrails
    expect(pipeline.edges.some((e) => e.source === extractNode.id && e.target === guardrailsNode.id)).toBe(true);
    // guardrails → composer
    expect(pipeline.edges.some((e) => e.source === guardrailsNode.id && e.target === composerNode.id)).toBe(true);
    // composer → output
    expect(pipeline.edges.some((e) => e.source === composerNode.id && e.target === outputNode.id)).toBe(true);
  });

  it('does NOT emit sequential-composer when only PII capabilities (no extraction)', () => {
    const { pipeline } = generatePipeline(baseRequest({
      capabilities: ['pii_detection', 'pii_redaction'],
      methodAssignments: {
        pii_detection: 'bedrock-guardrails',
        pii_redaction: 'bedrock-guardrails',
      },
    }));
    const types = pipeline.nodes.map((n) => n.type);
    expect(types).not.toContain('sequential-composer');
    // Both PII caps run on the single Guardrails method — no aggregator needed.
    expect(types).not.toContain('aggregator');
  });

  it('honors methodAssignments override: PII routed to claude stays parallel', () => {
    const { pipeline } = generatePipeline(baseRequest({
      capabilities: ['document_summarization', 'pii_redaction'],
      methodAssignments: {
        document_summarization: 'claude-sonnet',
        pii_redaction: 'claude-sonnet',
      },
    }));
    const types = pipeline.nodes.map((n) => n.type);
    expect(types).not.toContain('sequential-composer');
  });

  it('latency accounts for sequential extract + guardrails', () => {
    const { pipeline: parallel } = generatePipeline(baseRequest({
      capabilities: ['document_summarization'],
      methodAssignments: { document_summarization: 'claude-sonnet' },
    }));
    const { pipeline: sequential } = generatePipeline(baseRequest({
      capabilities: ['document_summarization', 'pii_redaction'],
      methodAssignments: {
        document_summarization: 'claude-sonnet',
        pii_redaction: 'bedrock-guardrails',
      },
    }));
    expect(sequential.estimatedLatencyMs).toBeGreaterThan(parallel.estimatedLatencyMs);
  });

  it('non-English document prevents guardrails selection (fallback to LLM, no composer)', () => {
    const { pipeline } = generatePipeline(baseRequest({
      capabilities: ['document_summarization', 'pii_redaction'],
      documentLanguages: ['ko'],
      // No explicit assignment; let selector pick per language constraints.
    }));
    const types = pipeline.nodes.map((n) => n.type);
    expect(types).not.toContain('sequential-composer');
    const methods = pipeline.nodes
      .filter((n) => n.type === 'method')
      .map((n) => (n.config as any).method as string);
    expect(methods).not.toContain('bedrock-guardrails');
  });

  it('rationale mentions sequential composition when mode is triggered', () => {
    const { rationale } = generatePipeline(baseRequest({
      capabilities: ['document_summarization', 'pii_redaction'],
      methodAssignments: {
        document_summarization: 'claude-sonnet',
        pii_redaction: 'bedrock-guardrails',
      },
    }));
    expect(rationale.toLowerCase()).toContain('sequential');
  });
});
