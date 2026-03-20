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
} from './types/capabilities.js';
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
} from './types/processing.js';
export {
  CONVERSE_API_LIMITS,
  BDA_LIMITS,
  BDA_STANDARD_OUTPUT,
  TEXTRACT_LIMITS,
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
