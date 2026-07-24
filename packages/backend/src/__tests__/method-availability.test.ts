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
