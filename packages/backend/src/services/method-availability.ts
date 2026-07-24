import {
  BDA_LIMITS,
  TEXTRACT_LIMITS,
  METHOD_INFO,
  METHODS,
  isMethodLanguageCompatible,
  type ProcessingMethod,
  type Capability,
} from '@idp/shared';
import { config } from '../config/aws.js';

/**
 * Single source of truth for "can this method run right now, and if not, why?".
 *
 * This logic used to be copy-pasted into /preview, /pipeline and /process with
 * subtle differences, which is how methods ended up advertised in one place and
 * failing in another. Every caller now shares these rules, and the same reasons
 * are surfaced to the UI via GET /api/methods so unavailability is visible
 * BEFORE a run instead of appearing as a late error.
 */

export type UnavailableReason =
  | 'bda-not-configured'
  | 'bda-custom-not-configured'
  | 'guardrails-not-configured'
  | 'guardrails-needs-pii-capability'
  | 'unsupported-format'
  | 'unsupported-language'
  | 'no-processor';

export interface MethodAvailability {
  method: ProcessingMethod;
  available: boolean;
  reason?: UnavailableReason;
  /** Human-readable explanation, safe to show in the UI. */
  detail?: string;
}

export interface AvailabilityContext {
  /** File extension without the dot, e.g. "pdf". Omit to skip format checks. */
  extension?: string;
  /** Detected document languages (ISO codes). Omit to skip language checks. */
  languages?: readonly string[];
  /** Requested capabilities, used for the Guardrails PII rule. */
  capabilities?: readonly Capability[];
  /** Methods that have a registered processor. */
  hasProcessor?: (method: ProcessingMethod) => boolean;
  /**
   * Guardrails inside a sequential composer is fed text by an upstream LLM
   * stage, so it does not need a Textract-compatible input format.
   */
  guardrailsFedByUpstream?: boolean;
}

const PII_CAPABILITIES: ReadonlySet<string> = new Set(['pii_detection', 'pii_redaction']);

function normalizeExtension(ext?: string): string | undefined {
  if (!ext) return undefined;
  const e = ext.toLowerCase().replace(/^\./, '');
  if (e === 'jpg') return 'jpeg';
  if (e === 'tif') return 'tiff';
  return e;
}

/** Configuration-only availability: does this deployment support the method at all? */
export function isMethodConfigured(method: ProcessingMethod): MethodAvailability {
  if (method === 'bda-custom' && !config.bdaProjectArn) {
    return {
      method,
      available: false,
      reason: 'bda-custom-not-configured',
      detail: 'Needs a custom blueprint project, which is not configured.',
    };
  }
  if (method.startsWith('bda-') && method !== 'bda-custom' && !config.bdaProfileArn) {
    return {
      method,
      available: false,
      reason: 'bda-not-configured',
      detail: 'Bedrock Data Automation is not configured in this deployment.',
    };
  }
  if (method === 'bedrock-guardrails' && !config.bedrockGuardrailId) {
    return {
      method,
      available: false,
      reason: 'guardrails-not-configured',
      detail: 'Bedrock Guardrails is not configured in this deployment.',
    };
  }
  return { method, available: true };
}

/** Full availability for a concrete run (format, language and capability aware). */
export function getMethodAvailability(
  method: ProcessingMethod,
  ctx: AvailabilityContext = {},
): MethodAvailability {
  if (ctx.hasProcessor && !ctx.hasProcessor(method)) {
    return {
      method,
      available: false,
      reason: 'no-processor',
      detail: 'This method has no runnable processor in this build.',
    };
  }

  const configured = isMethodConfigured(method);
  if (!configured.available) return configured;

  const ext = normalizeExtension(ctx.extension);
  if (ext) {
    const bdaFormats = BDA_LIMITS.async.supportedFormats as readonly string[];
    const textractFormats = TEXTRACT_LIMITS.analyzeDocument.supportedFormats as readonly string[];

    if (method.startsWith('bda-') && !bdaFormats.includes(ext)) {
      return {
        method,
        available: false,
        reason: 'unsupported-format',
        detail: `Bedrock Data Automation does not accept .${ext} files.`,
      };
    }
    if (method.startsWith('textract-') && !textractFormats.includes(ext)) {
      return {
        method,
        available: false,
        reason: 'unsupported-format',
        detail: `Amazon Textract does not accept .${ext} files.`,
      };
    }
    if (
      method === 'bedrock-guardrails' &&
      !ctx.guardrailsFedByUpstream &&
      !textractFormats.includes(ext)
    ) {
      return {
        method,
        available: false,
        reason: 'unsupported-format',
        detail: `Guardrails reads text via Textract, which does not accept .${ext} files. Run an LLM extraction stage first.`,
      };
    }
  }

  if (method === 'bedrock-guardrails' && ctx.capabilities) {
    const wantsPii = ctx.capabilities.some((c) => PII_CAPABILITIES.has(c));
    if (!wantsPii) {
      return {
        method,
        available: false,
        reason: 'guardrails-needs-pii-capability',
        detail: 'Guardrails only applies to PII detection or redaction.',
      };
    }
  }

  if (ctx.languages?.length && !isMethodLanguageCompatible(method, ctx.languages as string[])) {
    return {
      method,
      available: false,
      reason: 'unsupported-language',
      detail: `${METHOD_INFO[method].name} does not reliably support ${ctx.languages.join(', ')}.`,
    };
  }

  return { method, available: true };
}

/** Availability for every method in the catalog. */
export function getAllMethodAvailability(
  ctx: AvailabilityContext = {},
): MethodAvailability[] {
  return (METHODS as readonly ProcessingMethod[]).map((m) => getMethodAvailability(m, ctx));
}
