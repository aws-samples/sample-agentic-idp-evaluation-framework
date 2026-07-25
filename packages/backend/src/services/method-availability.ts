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
import { AUDIO_EXTENSIONS, CONVERSE_VIDEO_FORMATS } from '../adapters/extraction-shared.js';

/** Video containers Converse accepts, as a bare-extension matcher. */
const VIDEO_EXTENSIONS = new RegExp(`\\.(${Object.keys(CONVERSE_VIDEO_FORMATS).join('|')})$`, 'i');

/**
 * Families that can actually read a video, verified against live Bedrock.
 *
 * `nova` — Converse's native video block. Verified on a real 9s mp4.
 * `video-understanding` — TwelveLabs Pegasus, via InvokeModel + inference profile
 *   (NOT Converse), which is why it must be listed explicitly rather than inferred
 *   from "is a multimodal LLM".
 *
 * `claude` is deliberately ABSENT: Converse has a video block, but every Claude tier
 * REJECTS it — all 7 failed with "This model doesn't support the video content block
 * that you provided" on the same file Nova read correctly. GPT goes through the Mantle
 * Responses API, which has no video block at all.
 *
 * The lesson encoded here: the API surface having a feature is not the same as a model
 * accepting it. Verify with a real file before adding a family.
 */
const VIDEO_CAPABLE_FAMILIES: ReadonlySet<string> = new Set(['nova', 'video-understanding']);

/**
 * Families that can read ONLY video — nothing else.
 *
 * Pegasus takes TEXT + VIDEO inputs (per the catalog); it has no document or image
 * path at all. The gate below excluded non-video methods FROM video but had no
 * converse rule, so Pegasus was offered for every PDF and image: it ran, was billed,
 * and produced nothing useful about a document it could not see. Being video-capable
 * and being document-capable are independent properties and both need checking.
 */
const VIDEO_ONLY_FAMILIES: ReadonlySet<string> = new Set(['video-understanding']);

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
  | 'unsupported-region'
  | 'not-implemented'
  /** Specialist OCR method whose self-hosted SageMaker endpoint is not deployed. */
  | 'sagemaker-endpoint-not-configured'
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

/**
 * Does BDA accept this extension in any of its modalities?
 *
 * BDA_LIMITS declares separate format lists for documents (`async`), `video` and
 * `audio`. Checking only the document list rejected every media file.
 */
function bdaAcceptsFormat(ext: string): boolean {
  const lists: ReadonlyArray<readonly string[]> = [
    BDA_LIMITS.async.supportedFormats,
    BDA_LIMITS.video.supportedFormats,
    BDA_LIMITS.audio.supportedFormats,
  ];
  return lists.some((formats) => (formats as readonly string[]).includes(ext));
}

function normalizeExtension(ext?: string): string | undefined {
  if (!ext) return undefined;
  const e = ext.toLowerCase().replace(/^\./, '');
  if (e === 'jpg') return 'jpeg';
  if (e === 'tif') return 'tiff';
  return e;
}

/**
 * Regions in which Amazon Nova Multimodal Embeddings is offered.
 *
 * Verified with `bedrock list-foundation-models`:
 * `amazon.nova-2-multimodal-embeddings-v1:0` is returned in us-east-1 and NOT in
 * us-west-2, which is where this app is deployed.
 */
const EMBEDDINGS_REGIONS: ReadonlySet<string> = new Set(['us-east-1']);

/** Configuration-only availability: does this deployment support the method at all? */
export function isMethodConfigured(method: ProcessingMethod): MethodAvailability {
  /*
   * Nova Embeddings is catalog-only: it has no processor in ANY of the three
   * route registries (see processor-registry-parity.test.ts, which lists it as
   * deliberately exempt), and its model is not offered in this region at all.
   *
   * It was nonetheless reported `available: true` by GET /api/methods, and both
   * `embedding_generation` and `knowledge_base_ingestion` map exclusively to it —
   * so requesting either produced a pipeline whose only method node could never
   * execute. Verified live: POST /api/pipeline/generate with
   * ["embedding_generation"] returned methods: ["nova-embeddings"].
   *
   * Reporting it unavailable, with the reason, is the honest answer: the method
   * stays visible in the catalog as a documented option without pretending this
   * deployment can run it.
   */
  if (method === 'nova-embeddings') {
    if (!EMBEDDINGS_REGIONS.has(config.region)) {
      return {
        method,
        available: false,
        reason: 'unsupported-region',
        detail: `Nova Multimodal Embeddings is only offered in ${[...EMBEDDINGS_REGIONS].join(', ')}; this deployment runs in ${config.region}.`,
      };
    }
    return {
      method,
      available: false,
      reason: 'not-implemented',
      detail: 'Embedding generation is catalogued for comparison but has no runnable processor yet.',
    };
  }

  /*
   * Specialist OCR: needs an endpoint YOU deployed.
   *
   * These run on GPU instances that bill hourly whether or not they serve traffic
   * (ml.g6e.2xlarge $2.24/hr, ml.g7e.4xlarge $7.09/hr), so they are opt-in and off by
   * default. Reporting unavailable-with-reason keeps them visible in the catalog as
   * documented, benchmarked options — with their measured F1 and cost — without
   * pretending this deployment can run them. Same contract as bda-custom.
   */
  if (method.startsWith('sagemaker-') && !config.sagemakerOcrEndpoints[method]) {
    return {
      method,
      available: false,
      reason: 'sagemaker-endpoint-not-configured',
      detail:
        'Needs a self-hosted SageMaker endpoint, which is not deployed here. These run '
        + 'on GPU instances billed hourly even when idle, so they are opt-in '
        + '(see infrastructure/sagemaker-ocr.tf, disabled by default).',
    };
  }

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
    const textractFormats = TEXTRACT_LIMITS.analyzeDocument.supportedFormats as readonly string[];

    /*
     * AUDIO is BDA-only. The Converse API accepts text, image, document and video
     * content blocks — but not audio — so a direct-LLM method used to receive a
     * UTF-8 decode of an MP3 container (binary noise) and report a priced
     * "success" over hallucinated output.
     *
     * VIDEO is different: Nova reads it through Converse's video block and Pegasus
     * through InvokeModel, both verified live. Claude is NOT included — every tier
     * rejects the video block despite Converse exposing one. Textract has no video
     * path at all.
     */
    const isBda = method.startsWith('bda-');
    if (AUDIO_EXTENSIONS.test(`.${ext}`) && !isBda) {
      return {
        method,
        available: false,
        reason: 'unsupported-format',
        detail: `${METHOD_INFO[method].name} cannot read audio. The Converse API has no audio content block — use a Bedrock Data Automation method.`,
      };
    }
    if (VIDEO_EXTENSIONS.test(`.${ext}`) && !isBda && !VIDEO_CAPABLE_FAMILIES.has(METHOD_INFO[method].family)) {
      return {
        method,
        available: false,
        reason: 'unsupported-format',
        detail: `${METHOD_INFO[method].name} cannot read video. Use a multimodal LLM or a Bedrock Data Automation method.`,
      };
    }
    /*
     * The converse rule: a video-only model must not be offered for a document.
     *
     * Without this, Pegasus was run on every PDF and image upload — a real charge for
     * a model that has no document input path, so the result could only ever be
     * useless. The video gate above is not symmetric on its own.
     */
    if (!VIDEO_EXTENSIONS.test(`.${ext}`) && VIDEO_ONLY_FAMILIES.has(METHOD_INFO[method].family)) {
      return {
        method,
        available: false,
        reason: 'unsupported-format',
        detail: `${METHOD_INFO[method].name} reads video only — it has no document or image input path. Upload a video to compare it.`,
      };
    }

    // BDA accepts documents, video AND audio, each with its own format list.
    // Only the document list was consulted, so BDA was rejected for the media it
    // is specifically the right tool for — leaving media uploads with no runnable
    // method at all once the direct-LLM methods are (correctly) excluded above.
    if (method.startsWith('bda-') && !bdaAcceptsFormat(ext)) {
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
