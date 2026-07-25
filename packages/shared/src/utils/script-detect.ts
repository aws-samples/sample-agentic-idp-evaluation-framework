/**
 * Detect which writing systems a document uses, from its extracted text.
 *
 * Why this exists: `isMethodLanguageCompatible` already excludes BDA and
 * Textract+LLM for non-English documents, and that rule is CORRECT — measured on a
 * real Korean quotation, every BDA method recovered 32% of known content and every
 * Textract hybrid 37-42%, while Claude and GPT tiers scored 100%. But the rule only
 * fires when `documentLanguages` is populated, and the only thing that populated it
 * was the Socratic interview. Anyone who clicked "Skip questions, use defaults" got
 * Korean routed to the methods that recover a third of the document, with no
 * warning. The document itself is the evidence; the interview should not be load
 * bearing for a correctness rule.
 *
 * Script, not language: distinguishing Korean from Japanese is unnecessary here and
 * would need a real model. The routing rule only asks "is this Latin script?",
 * because that is what BDA and Textract are trained for. Script detection from
 * Unicode ranges is exact, needs no model, and cannot be wrong about the thing we
 * are asking.
 */

/** Unicode ranges per script, enough to separate the cases routing cares about. */
const SCRIPT_RANGES: Array<{ code: string; name: string; test: RegExp }> = [
  // Hangul syllables + Jamo. Korean.
  { code: 'ko', name: 'Korean', test: /[가-힯ᄀ-ᇿ㄰-㆏]/ },
  // Hiragana + Katakana. Japanese (Kanji alone is ambiguous with Chinese, so the
  // kana are what identify it).
  { code: 'ja', name: 'Japanese', test: /[぀-ゟ゠-ヿ]/ },
  // CJK Unified Ideographs without kana or hangul: treat as Chinese.
  { code: 'zh', name: 'Chinese', test: /[一-鿿]/ },
  { code: 'ar', name: 'Arabic', test: /[؀-ۿݐ-ݿ]/ },
  { code: 'he', name: 'Hebrew', test: /[֐-׿]/ },
  { code: 'th', name: 'Thai', test: /[฀-๿]/ },
  { code: 'ru', name: 'Cyrillic', test: /[Ѐ-ӿ]/ },
  { code: 'hi', name: 'Devanagari', test: /[ऀ-ॿ]/ },
];

/** Latin letters, so "has English-ish text" can be answered too. */
const LATIN = /[A-Za-z]/;

/**
 * Fraction of non-Latin script characters above which the document is treated as
 * primarily non-Latin.
 *
 * A low bar on purpose: a single Korean address block on an otherwise English
 * invoice is still content BDA will mangle, and the cost of routing to a
 * multimodal LLM instead is a few cents. But it must not be zero — one stray CJK
 * glyph in a font name or a copyright line should not reroute an English document.
 */
const NON_LATIN_THRESHOLD = 0.02;

export interface ScriptDetection {
  /**
   * BCP-47-ish codes, primary first. Ordered so `isMethodLanguageCompatible`, which
   * reads `languages[0]`, sees the dominant script.
   */
  languages: string[];
  /** Human-readable script names, for showing the user why routing changed. */
  scripts: string[];
  /** Share of letters that are non-Latin, 0-1. */
  nonLatinRatio: number;
}

/**
 * Scripts present in `text`, primary first.
 *
 * Returns an empty `languages` array for text with no letters at all (a page of
 * numbers, or an unparseable extraction), because guessing "English" there would
 * silently re-enable the methods this exists to exclude.
 */
export function detectScripts(text: string): ScriptDetection {
  if (!text) return { languages: [], scripts: [], nonLatinRatio: 0 };

  // Sample rather than scan megabytes: script identity is stable across a document,
  // and preview text can be large.
  const sample = text.length > 200_000 ? text.slice(0, 200_000) : text;

  let latinCount = 0;
  let nonLatinCount = 0;
  const counts = new Map<string, { name: string; n: number }>();

  for (const ch of sample) {
    if (LATIN.test(ch)) {
      latinCount++;
      continue;
    }
    for (const range of SCRIPT_RANGES) {
      if (!range.test.test(ch)) continue;
      nonLatinCount++;
      const hit = counts.get(range.code) ?? { name: range.name, n: 0 };
      hit.n++;
      counts.set(range.code, hit);
      break;
    }
  }

  const totalLetters = latinCount + nonLatinCount;
  if (totalLetters === 0) return { languages: [], scripts: [], nonLatinRatio: 0 };

  const nonLatinRatio = nonLatinCount / totalLetters;

  // Kana presence means Japanese even when Kanji outnumber it, so a document with
  // both is reported as Japanese rather than Chinese.
  if (counts.has('ja')) counts.delete('zh');

  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const languages: string[] = [];
  const scripts: string[] = [];

  if (nonLatinRatio >= NON_LATIN_THRESHOLD) {
    for (const [code, { name }] of ranked) {
      languages.push(code);
      scripts.push(name);
    }
    if (latinCount > 0) languages.push('en');
  } else if (latinCount > 0) {
    languages.push('en');
    scripts.push('Latin');
  }

  return { languages, scripts, nonLatinRatio };
}
