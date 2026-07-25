import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Availability rules used to be duplicated across /preview, /pipeline and
 * /process, which is how a method could be advertised in one place and rejected
 * in another. These tests pin the shared rules.
 */

const mockConfig = {
  bdaProfileArn: 'arn:aws:bedrock:us-west-2:111122223333:data-automation-profile/us.data-automation-v1',
  bdaProjectArn: '',
  bedrockGuardrailId: 'gr-123',
};

vi.mock('../config/aws.js', () => ({
  get config() {
    return mockConfig;
  },
}));

const { getMethodAvailability, isMethodConfigured } = await import(
  '../services/method-availability.js'
);

const original = { ...mockConfig };
beforeEach(() => Object.assign(mockConfig, original));
afterEach(() => vi.restoreAllMocks());

describe('configuration rules', () => {
  it('BDA methods are available when a profile ARN is set', () => {
    expect(isMethodConfigured('bda-standard').available).toBe(true);
    expect(isMethodConfigured('bda-claude-sonnet').available).toBe(true);
  });

  it('BDA methods become unavailable without a profile ARN', () => {
    mockConfig.bdaProfileArn = '';
    const r = isMethodConfigured('bda-standard');
    expect(r.available).toBe(false);
    expect(r.reason).toBe('bda-not-configured');
    expect(r.detail).toBeTruthy();
  });

  it('bda-custom needs its own project ARN, independent of the profile ARN', () => {
    const r = isMethodConfigured('bda-custom');
    expect(r.available).toBe(false);
    expect(r.reason).toBe('bda-custom-not-configured');

    mockConfig.bdaProjectArn = 'arn:aws:bedrock:us-west-2:111122223333:data-automation-project/abc';
    expect(isMethodConfigured('bda-custom').available).toBe(true);
  });

  it('Guardrails needs a guardrail id', () => {
    mockConfig.bedrockGuardrailId = '';
    const r = isMethodConfigured('bedrock-guardrails');
    expect(r.available).toBe(false);
    expect(r.reason).toBe('guardrails-not-configured');
  });

  it('plain LLM methods are unaffected by BDA/Guardrails configuration', () => {
    mockConfig.bdaProfileArn = '';
    mockConfig.bedrockGuardrailId = '';
    expect(isMethodConfigured('claude-opus-5').available).toBe(true);
    expect(isMethodConfigured('gpt-5-6-sol').available).toBe(true);
    expect(isMethodConfigured('nova-lite').available).toBe(true);
  });

  it('user-facing detail never leaks env var names', () => {
    mockConfig.bdaProfileArn = '';
    mockConfig.bedrockGuardrailId = '';
    for (const m of ['bda-standard', 'bda-custom', 'bedrock-guardrails'] as const) {
      const detail = isMethodConfigured(m).detail ?? '';
      expect(detail).not.toMatch(/_ARN|_ID|BDA_|BEDROCK_/);
    }
  });
});

describe('format rules', () => {
  it('BDA rejects formats it cannot read', () => {
    // BDA accepts pdf/tiff/jpeg/png/docx — spreadsheets are not in that list.
    const r = getMethodAvailability('bda-standard', { extension: 'xlsx' });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('unsupported-format');
  });

  it('BDA accepts docx, which Textract does not', () => {
    expect(getMethodAvailability('bda-standard', { extension: 'docx' }).available).toBe(true);
  });

  it('Textract methods reject unsupported formats', () => {
    const r = getMethodAvailability('textract-claude-sonnet', { extension: 'docx' });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('unsupported-format');
  });

  it('normalizes jpg→jpeg and tif→tiff so common extensions are accepted', () => {
    expect(getMethodAvailability('textract-claude-sonnet', { extension: 'jpg' }).available).toBe(true);
    expect(getMethodAvailability('textract-claude-sonnet', { extension: 'tif' }).available).toBe(true);
  });

  it('tolerates a leading dot on the extension', () => {
    expect(getMethodAvailability('textract-claude-sonnet', { extension: '.pdf' }).available).toBe(true);
  });

  it('LLM methods accept formats BDA and Textract cannot', () => {
    expect(getMethodAvailability('claude-opus-5', { extension: 'docx' }).available).toBe(true);
  });
});

describe('Guardrails-specific rules', () => {
  it('is unavailable when no PII capability is requested', () => {
    const r = getMethodAvailability('bedrock-guardrails', {
      extension: 'pdf',
      capabilities: ['text_extraction'],
    });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('guardrails-needs-pii-capability');
  });

  it('is available for PII capabilities', () => {
    expect(
      getMethodAvailability('bedrock-guardrails', {
        extension: 'pdf',
        capabilities: ['pii_redaction'],
      }).available,
    ).toBe(true);
  });

  it('needs a Textract-readable format when run standalone', () => {
    const r = getMethodAvailability('bedrock-guardrails', {
      extension: 'docx',
      capabilities: ['pii_detection'],
    });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('unsupported-format');
  });

  it('skips the format check when fed by an upstream extraction stage', () => {
    // Inside a sequential composer the upstream LLM supplies the text, so the
    // original file format is irrelevant.
    const r = getMethodAvailability('bedrock-guardrails', {
      extension: 'docx',
      capabilities: ['pii_detection'],
      guardrailsFedByUpstream: true,
    });
    expect(r.available).toBe(true);
  });
});

describe('processor + language rules', () => {
  it('reports methods with no registered processor', () => {
    const r = getMethodAvailability('claude-opus-5', { hasProcessor: () => false });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('no-processor');
  });

  it('rejects methods that cannot handle the detected language', () => {
    const r = getMethodAvailability('bda-standard', { extension: 'pdf', languages: ['ko'] });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('unsupported-language');
  });

  it('allows multilingual LLMs on non-English documents', () => {
    expect(
      getMethodAvailability('claude-opus-5', { extension: 'pdf', languages: ['ko'] }).available,
    ).toBe(true);
  });

  it('with no context, only configuration is checked', () => {
    expect(getMethodAvailability('claude-opus-5').available).toBe(true);
  });
});

/**
 * Audio/video reached the direct-LLM adapters, which decoded the container as
 * UTF-8 and asked the model to extract fields from binary noise. The run was then
 * reported as a priced success over meaningless output. Media must only be
 * offered to the managed BDA path.
 */
describe('media files (audio/video)', () => {
  const AUDIO = ['mp3', 'wav', 'flac', 'm4a', 'ogg'];
  const VIDEO = ['mp4', 'mov', 'mkv', 'webm'];
  const NON_BDA = [
    'claude-sonnet', 'claude-opus-5', 'nova-lite', 'gpt-5-6-luna',
    'textract-claude-sonnet', 'textract-nova-lite',
  ] as const;

  it('never offers a non-BDA method for AUDIO', () => {
    // Converse accepts text, image, document and video content blocks — but not
    // audio — so a direct-LLM method would receive a UTF-8 decode of the container.
    for (const extension of AUDIO) {
      for (const method of NON_BDA) {
        const result = getMethodAvailability(method, { extension });
        expect(result.available, `${method} for .${extension}`).toBe(false);
        expect(result.detail).toMatch(/audio/i);
      }
    }
  });

  it('offers the models that can ACTUALLY read video', () => {
    /*
     * Nova via Converse's video block, and TwelveLabs Pegasus via InvokeModel — both
     * verified against live Bedrock on a real 9s mp4 with known content.
     *
     * This test previously asserted `claude-sonnet` was available for video, on the
     * reasoning that Converse has a video block. That reasoning was wrong: the API
     * having the block is not the same as a model accepting it.
     */
    for (const extension of VIDEO) {
      for (const method of ['nova-lite', 'twelvelabs-pegasus'] as const) {
        expect(
          getMethodAvailability(method, { extension }).available,
          `${method} for .${extension}`,
        ).toBe(true);
      }
    }
  });

  it('excludes every Claude tier for video — they reject the video block', () => {
    /*
     * Measured, not assumed: all 7 Claude tiers (Opus 5 / 4.8 / 4.7 / 4.6,
     * Sonnet 4.6 / 5, Haiku 4.5) failed on a real mp4 with
     *   "This model doesn't support the video content block that you provided."
     * while Nova read the identical file correctly. Offering them wasted a preview
     * slot on a guaranteed error.
     */
    for (const method of [
      'claude-sonnet', 'claude-haiku', 'claude-opus', 'claude-opus-5',
      'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5',
    ] as const) {
      const r = getMethodAvailability(method, { extension: 'mp4' });
      expect(r.available, `${method} must not be offered for video`).toBe(false);
    }
  });

  it('still excludes Textract and GPT for video (no video path)', () => {
    for (const method of ['textract-nova-lite', 'gpt-5-6-luna'] as const) {
      const r = getMethodAvailability(method, { extension: 'mp4' });
      expect(r.available, method).toBe(false);
    }
  });

  it('still allows BDA for media', () => {
    // bda-standard is the managed path that genuinely supports media.
    for (const extension of ['mp4', 'mp3']) {
      expect(getMethodAvailability('bda-standard', { extension }).available).toBe(true);
    }
  });

  it('does not affect document formats', () => {
    expect(getMethodAvailability('claude-sonnet', { extension: 'pdf' }).available).toBe(true);
    expect(getMethodAvailability('claude-sonnet', { extension: 'png' }).available).toBe(true);
  });
});
