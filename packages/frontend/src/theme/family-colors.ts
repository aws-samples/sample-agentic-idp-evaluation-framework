import type { MethodFamily } from '@idp/shared';

/**
 * Brand colour per method family, in ONE place.
 *
 * This map was duplicated in five components, and the copies had already begun to
 * drift. Adding two families broke all five at once — which the type checker caught
 * only because the maps are `Record<MethodFamily, …>` rather than partial. One
 * export means a new family is a single edit and the compiler still enforces
 * exhaustiveness. (Three of those five components have since been deleted along with
 * the unreachable /processing page; MethodNode is the remaining consumer.)
 *
 * These stay literal rather than moving to theme tokens: they are family identity,
 * legible on both light and dark surfaces, not themed chrome.
 */
export const FAMILY_COLORS: Record<MethodFamily, string> = {
  bda: '#0972d3',
  'bda-llm': '#0891b2',
  claude: '#8b5cf6',
  nova: '#ec7211',
  gpt: '#10a37f',
  'textract-llm': '#037f0c',
  embeddings: '#2563eb',
  guardrails: '#d13212',
  /** TwelveLabs Pegasus — purpose-built video understanding. */
  'video-understanding': '#c026d3',
  /** Self-hosted specialist OCR on SageMaker endpoints. */
  'sagemaker-ocr': '#b45309',
};

/**
 * Display name per family, also previously duplicated in four components.
 *
 * Kept beside the colours because the two are always used together, and because a
 * new family needs both — splitting them across modules is how one of them ends up
 * forgotten.
 */
export const FAMILY_LABELS: Record<MethodFamily, string> = {
  bda: 'BDA',
  'bda-llm': 'BDA+LLM',
  claude: 'Claude',
  nova: 'Nova',
  gpt: 'GPT',
  'textract-llm': 'Textract+LLM',
  embeddings: 'Embeddings',
  guardrails: 'Guardrails',
  'video-understanding': 'Pegasus (video)',
  'sagemaker-ocr': 'Specialist OCR',
};

/**
 * Full family name, for places with room to spell it out (the catalog on the landing
 * page). `FAMILY_LABELS` above is the compact form used in tables and chips.
 *
 * `Record<MethodFamily, …>` rather than a partial map, on purpose: the landing page
 * previously kept its own 8-entry name map, so the two newest families rendered with an
 * `undefined` heading — a group of six methods appeared under a bare count badge with no
 * title at all. A total record makes that a compile error instead.
 */
export const FAMILY_FULL_NAMES: Record<MethodFamily, string> = {
  bda: 'Bedrock Data Automation',
  'bda-llm': 'BDA → LLM hybrid',
  claude: 'Claude',
  nova: 'Amazon Nova',
  gpt: 'OpenAI GPT',
  'textract-llm': 'Textract → LLM hybrid',
  embeddings: 'Nova Embeddings',
  guardrails: 'Bedrock Guardrails',
  'video-understanding': 'TwelveLabs Pegasus',
  'sagemaker-ocr': 'Specialist OCR (self-hosted)',
};
