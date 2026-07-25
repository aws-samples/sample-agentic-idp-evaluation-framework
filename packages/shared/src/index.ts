// Types
export type {
  Capability,
  CapabilityInfo,
  CapabilityCategory,
  CategoryInfo,
} from './types/capabilities.js';
export type {
  DocumentType,
  DocumentTypeInfo,
} from './types/documents.js';
export type {
  ProcessingMethod,
  MethodFamily,
  MethodInfo,
  TokenPricing,
  SupportLevel,
  ProcessingStatus,
  CapabilityResult,
  ProcessorResult,
  ComparisonResult,
} from './types/processing.js';
export type {
  ConversationEvent,
  PipelineChatEvent,
  ProcessingEvent,
  ArchitectureEvent,
  CapabilityRecommendation,
  CostProjection,
} from './types/streaming.js';
export type {
  UploadResponse,
  ConversationRequest,
  ProcessRequest,
  ArchitectureRequest,
} from './types/api.js';
export type {
  PipelineNodeType,
  PipelineNode,
  PipelineNodeConfig,
  DocumentInputConfig,
  PageClassifierConfig,
  CapabilityNodeConfig,
  MethodNodeConfig,
  SequentialComposerConfig,
  AggregatorConfig,
  OutputConfig,
  PipelineEdge,
  PipelineDefinition,
  PipelineGenerateRequest,
  PipelineGenerateResponse,
  PipelineExecutionEvent,
} from './types/pipeline.js';

// Constants & data
export {
  CAPABILITIES,
  CAPABILITY_INFO,
  CAPABILITY_CATEGORIES,
  CATEGORY_INFO,
  getCapabilitiesByCategory,
  searchCapabilities,
  isModelBackedCapability,
  CAPABILITY_UNAVAILABLE_REASON,
  getUnavailableReason,
  filterModelBackedCapabilities,
} from './types/capabilities.js';
export type { RunStage, RunStageInfo, RunStageInput } from './types/runs.js';
export { getRunStage } from './types/runs.js';
export {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_INFO,
  getDocumentType,
  getAllAcceptedExtensions,
  getAllAcceptedMimeTypes,
} from './types/documents.js';
export {
  METHODS,
  METHOD_FAMILIES,
  METHOD_INFO,
  CAPABILITY_SUPPORT,
  getMethodFamily,
  getMethodsByFamily,
  getBestMethodsForCapability,
  getSupportLevel,
  CAPABILITY_SUPPORT_OVERRIDES,
  isMethodLanguageCompatible,
  TYPICAL_PAGE_TOKENS,
  estimateCostPerPage,
} from './types/processing.js';
export {
  CONVERSE_API_LIMITS,
  BDA_LIMITS,
  BDA_STANDARD_OUTPUT,
  TEXTRACT_LIMITS,
  TEXTRACT_PAGE_PRICING,
  METHOD_CONSTRAINTS,
  getMethodConstraints,
  getMethodLimitsSummary,
} from './constants/method-limits.js';
export type { MethodLimitKey, MethodConstraintSummary } from './constants/method-limits.js';

// Unified page representation (#4)
export type {
  UnifiedPageResult,
  UnifiedDocumentResult,
  ExtractedTable,
  ExtractedKVPair,
  ExtractedEntity,
} from './types/unified-page.js';

// Generated skill definitions (from skills/**/*.md)
export type { SkillId, SkillInfo } from './generated/skills.js';
export { SKILL_IDS, SKILL_INFO, GENERATED_CAPABILITIES, GENERATED_CAPABILITY_INFO } from './generated/skills.js';

// Feedback survey
export type {
  FeedbackRequest,
  FeedbackRecord,
  FeedbackStatus,
  FeedbackSummary,
} from './types/feedback.js';
export {
  FEEDBACK_RATING_MIN,
  FEEDBACK_RATING_MAX,
  FEEDBACK_RATING_STEP,
} from './types/feedback.js';

// Document schemas (#5)
export {
  DOCUMENT_SCHEMAS,
  getDocumentSchema,
  buildSchemaExtractionPrompt,
} from './schemas/index.js';
export type {
  DocumentClassSchema,
  DocumentFieldSchema,
} from './schemas/index.js';

// Model output ceilings, generated from the committed Bedrock catalog snapshot.
export { MODEL_MAX_OUTPUT_TOKENS, catalogMaxOutputTokens } from './generated/model-limits.js';

// Script detection from extracted text, so non-English routing does not depend on
// the advisor interview having run.
export { detectScripts } from './utils/script-detect.js';
export type { ScriptDetection } from './utils/script-detect.js';

// Product name and tagline, defined once so the tab title, top nav, hero, docs
// and generated code headers cannot drift into different names.
export {
  PRODUCT_NAME,
  PRODUCT_NAME_SHORT,
  PRODUCT_TAGLINE,
  PRODUCT_TAGLINE_SHORT,
} from './constants/branding.js';

// The four workflow steps: nav label, page title, description and gate copy in one
// place, so a nav item and the page it opens cannot disagree about its own name.
export {
  WORKFLOW_STEPS,
  TOTAL_STEPS,
  stepNumber,
  stepSubtitle,
} from './constants/steps.js';
export type { WorkflowStep } from './constants/steps.js';
