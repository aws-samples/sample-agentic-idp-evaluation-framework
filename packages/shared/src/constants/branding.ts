/**
 * The product's name and one-line description, defined ONCE.
 *
 * These strings were previously written out by hand in six places and had drifted
 * into six different names: the browser tab said "IDP Evaluation Framework", the
 * top nav "ONE IDP Framework", the landing hero "IDP Evaluation Framework", the
 * splash screen "Loading ONE IDP", the docs sidebar "ONE IDP Docs", the feedback
 * modal "the ONE IDP evaluation platform", and generated code headers "ONE IDP
 * Platform". A user moving between the tab title, the header and the docs saw three
 * products.
 *
 * Kept in `shared` because both the frontend and the backend's code generator emit
 * the name — the generated README and Python/TypeScript headers are customer-facing
 * artifacts and were the worst offenders ("ONE IDP Platform", a name used nowhere
 * else).
 */

/** Full product name. Use in titles, headers and generated file headers. */
export const PRODUCT_NAME = 'ONE IDP Evaluation Framework';

/**
 * Short form, for space-constrained UI (docs sidebar, splash, breadcrumbs).
 * Still recognisably the same product — NOT a different name.
 */
export const PRODUCT_NAME_SHORT = 'ONE IDP';

/**
 * One sentence on what it does, in the user's terms.
 *
 * Written as an outcome rather than a feature list: the previous descriptions
 * ("Evaluate, compare, and recommend the optimal AWS document processing approach")
 * described the software's activity, not what the reader gets.
 */
export const PRODUCT_TAGLINE =
  'Find the best AWS document processing method for your documents — by running them all and comparing real cost, speed and accuracy.';

/** Compact tagline for the browser tab's meta description and social previews. */
export const PRODUCT_TAGLINE_SHORT =
  'Compare AWS document processing methods side by side on your own documents.';
