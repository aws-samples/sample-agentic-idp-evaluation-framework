/**
 * Types for `word-extractor`, which ships none and has no @types package.
 *
 * Declared narrowly — only the surface file-converter.ts actually uses — rather than as
 * `declare module 'word-extractor'` (which would type the whole thing as `any` and let a
 * typo through silently). Verified against the runtime API on v1.0.4: `extract()` accepts
 * a Buffer or a path and resolves to a document whose section getters return strings.
 */
declare module 'word-extractor' {
  interface WordDocument {
    /** Main document body text. */
    getBody(): string;
    /** Header text, which carries letterheads and document ids. */
    getHeaders(): string;
    getFooters(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getAnnotations(): string;
    getTextboxes(): string;
  }

  export default class WordExtractor {
    /** Accepts a Buffer (what the upload path holds) or a filesystem path. */
    extract(source: Buffer | string): Promise<WordDocument>;
  }
}
