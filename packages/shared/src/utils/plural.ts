/**
 * Count-with-noun formatting, so the UI never says "1 pages".
 *
 * Every call site wrote `{n} pages` inline, which reads wrong on the single most
 * common case for this app: a one-page document. The step sub-title got it right
 * (`stepSubtitle` special-cased it) while the panel directly beneath it said
 * "1 pages" — the same number, formatted two different ways, on one screen.
 *
 * Deliberately tiny and English-only. This is presentation polish, not i18n: adding
 * a full plural-rules library would imply the rest of the UI is localisable, and it
 * is not.
 */

/** Irregular plurals actually used in this UI. Regular nouns just take "s". */
const IRREGULAR: Record<string, string> = {
  capability: 'capabilities',
  entity: 'entities',
  category: 'categories',
  is: 'are',
  was: 'were',
  has: 'have',
  this: 'these',
};

/** `plural(1, 'page')` -> "page"; `plural(2, 'page')` -> "pages". */
export function plural(count: number, noun: string): string {
  if (count === 1) return noun;
  return IRREGULAR[noun] ?? `${noun}s`;
}

/**
 * `countOf(1, 'page')` -> "1 page"; `countOf(0, 'method')` -> "0 methods".
 *
 * Zero takes the plural, which is correct English ("0 methods returned a result")
 * and matches how the progress panel reads mid-run.
 */
export function countOf(count: number, noun: string): string {
  return `${count} ${plural(count, noun)}`;
}
