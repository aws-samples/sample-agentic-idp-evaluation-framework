import { describe, it, expect } from 'vitest';
import type { PipelineGenerateRequest, ProcessingMethod } from '@idp/shared';
import { METHOD_INFO, getMethodFamily, getSupportLevel } from '@idp/shared';
import { generatePipeline } from '../services/pipeline-generator.js';
import { buildSystemPrompt, CAPABILITY_GUIDANCE } from '../adapters/extraction-shared.js';
import { isEmptyExtraction } from '../processors/processor-base.js';

const STRATEGIES = ['balanced', 'accuracy', 'cost', 'speed'] as const;
const MEDIA_CAPS = [
  'video_summarization',
  'video_chapter_extraction',
  'content_moderation',
] as const;

function methodsFor(
  documentType: string,
  capability: string,
  optimizeFor: (typeof STRATEGIES)[number],
): ProcessingMethod[] {
  const request = {
    documentType,
    capabilities: [capability],
    optimizeFor,
    enableHybridRouting: false,
  } as unknown as PipelineGenerateRequest;
  const { pipeline } = generatePipeline(request);
  return pipeline.nodes
    .filter((n) => n.type === 'method')
    .map((n) => (n.config as { method: ProcessingMethod }).method);
}

/**
 * Every assertion here encodes something MEASURED against live Bedrock on a real
 * 9-second mp4 through the deployed stack — not inferred from the API surface.
 * That distinction is the whole point: the Converse API HAS a `video` content
 * block, which is why Claude was wrongly offered for video, but having the block
 * is not the same as a model accepting it.
 */
describe('video routing reflects what models actually accept', () => {
  it('never offers Claude for video — every tier rejects the video block', () => {
    /*
     * All 7 Claude tiers (Opus 5 / 4.8 / 4.7 / 4.6, Sonnet 4.6 / 5, Haiku 4.5)
     * failed identically on a real mp4:
     *   "This model doesn't support the video content block that you provided."
     * Only Nova read the same file correctly.
     */
    for (const capability of MEDIA_CAPS) {
      for (const optimizeFor of STRATEGIES) {
        for (const method of methodsFor('video', capability, optimizeFor)) {
          const family = getMethodFamily(method);
          expect(
            family,
            `${capability}/${optimizeFor} picked ${method} (${family}); Claude cannot read video`,
          ).not.toBe('claude');
        }
      }
    }
  });

  it('offers only families with a proven video path', () => {
    // bda / bda-llm (managed extraction) and nova (Converse video block). Textract
    // has no video path; GPT goes through Mantle, which has no video block.
    const OK = new Set(['bda', 'bda-llm', 'nova']);
    for (const capability of MEDIA_CAPS) {
      for (const optimizeFor of STRATEGIES) {
        const methods = methodsFor('video', capability, optimizeFor);
        expect(methods.length, `${capability}/${optimizeFor}`).toBeGreaterThan(0);
        for (const method of methods) {
          expect(OK.has(getMethodFamily(method)), `${capability}/${optimizeFor} -> ${method}`).toBe(true);
        }
      }
    }
  });

  it('keeps audio on BDA only — Converse has no audio content block', () => {
    for (const capability of ['audio_transcription', 'audio_summarization'] as const) {
      for (const optimizeFor of STRATEGIES) {
        const methods = methodsFor('audio', capability, optimizeFor);
        expect(methods.length, `${capability}/${optimizeFor}`).toBeGreaterThan(0);
        for (const method of methods) {
          expect(method.startsWith('bda-'), `${capability}/${optimizeFor} -> ${method}`).toBe(true);
        }
      }
    }
  });

  it('rates BDA+LLM as strongly as raw BDA for media', () => {
    // BDA is to media what Textract is to pages: a managed extractor whose output
    // an LLM then structures. The two-stage path is the preferred one, so it must
    // not be rated below the raw managed output it builds on.
    for (const capability of [...MEDIA_CAPS, 'audio_transcription', 'audio_summarization']) {
      const bda = getSupportLevel('bda-standard', capability as never);
      const bdaLlm = getSupportLevel('bda-claude-sonnet', capability as never);
      expect(bdaLlm, `${capability}: bda-llm should be rated for media`).toBeTruthy();
      expect(
        bdaLlm === 'excellent' || bdaLlm === bda,
        `${capability}: bda-llm (${bdaLlm}) rated below bda (${bda})`,
      ).toBe(true);
    }
  });
});

/**
 * The prompt was the entire reason video returned nothing. Proven by A/B against
 * live Bedrock: same model, same video, same bytes — the old wording produced
 * `data: []` at confidence 0, the media-aware wording produced a full summary at
 * confidence 0.9 with every ground-truth string recovered.
 */
describe('the system prompt names the medium it was handed', () => {
  it('does not call a video a document', () => {
    const prompt = buildSystemPrompt(['video_summarization']);
    expect(prompt).toContain('media processing AI');
    expect(prompt).toContain('media file provided');
    expect(prompt).not.toContain('document processing AI');
  });

  it('still says document for real documents', () => {
    const prompt = buildSystemPrompt(['table_extraction']);
    expect(prompt).toContain('document processing AI');
    expect(prompt).not.toContain('media processing AI');
  });

  it('gives every media capability real guidance, not the generic fallback', () => {
    for (const capability of [...MEDIA_CAPS, 'audio_transcription', 'audio_summarization']) {
      expect(CAPABILITY_GUIDANCE[capability], `${capability} has no guidance`).toBeTruthy();
      const prompt = buildSystemPrompt([capability]);
      // The generic fallback is what produced the empty extraction.
      expect(prompt).not.toContain(`Extract ${capability.replace(/_/g, ' ')} data.`);
    }
  });

  it('tells the model to match the spoken language for media', () => {
    expect(buildSystemPrompt(['audio_transcription'])).toContain('spoken or on-screen language');
    expect(buildSystemPrompt(['table_extraction'])).toContain('document language');
  });
});

/**
 * A response that parsed is not a response that answered. Nova "succeeded" on
 * video in 919ms for $0.0004 having extracted nothing, and it was presented as a
 * priced success — which hid the prompt bug above and would hide the next one.
 */
describe('isEmptyExtraction', () => {
  it('treats blank containers and strings as empty', () => {
    for (const v of [null, undefined, '', '   ', [], {}]) {
      expect(isEmptyExtraction(v), JSON.stringify(v)).toBe(true);
    }
  });

  it('does NOT treat 0 or false as empty', () => {
    // These are real answers to "how many" and "is it signed" — discarding them
    // would turn a correct extraction into a reported failure.
    expect(isEmptyExtraction(0)).toBe(false);
    expect(isEmptyExtraction(false)).toBe(false);
  });

  it('treats real content as non-empty', () => {
    expect(isEmptyExtraction('text')).toBe(false);
    expect(isEmptyExtraction([1])).toBe(false);
    expect(isEmptyExtraction({ a: 1 })).toBe(false);
  });
});

/** Sanity: the catalog still has a runnable video method at all. */
describe('video is routable', () => {
  it('produces at least one method for a video summary', () => {
    const methods = methodsFor('video', 'video_summarization', 'balanced');
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) expect(METHOD_INFO[m]).toBeTruthy();
  });
});
