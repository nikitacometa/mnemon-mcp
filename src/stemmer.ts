/**
 * Snowball stemmer wrapper with automatic Russian/English language detection.
 *
 * Used at query time to improve FTS5 prefix matching:
 * - "субличностях" → stem "субличн" → FTS5 "субличн"* matches "субличность"
 * - "meditation" → stem "medit" → FTS5 "medit"* matches "meditating"
 *
 * Language detection: Cyrillic chars → Russian, otherwise → English.
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const ruModule = require("snowball-stemmer.jsx/dest/russian-stemmer.common.js") as {
  RussianStemmer: new () => SnowballStemmer;
};
const enModule = require("snowball-stemmer.jsx/dest/english-stemmer.common.js") as {
  EnglishStemmer: new () => SnowballStemmer;
};

interface SnowballStemmer {
  stemWord(word: string): string;
}

const ruStemmer = new ruModule.RussianStemmer();
const enStemmer = new enModule.EnglishStemmer();

const CYRILLIC_RE = /[\u0400-\u04FF]/;

/** Detect if a word contains Cyrillic characters */
function isCyrillic(word: string): boolean {
  return CYRILLIC_RE.test(word);
}

/**
 * Stem a single word using the appropriate Snowball stemmer.
 * Returns the stemmed form (lowercase).
 *
 * If the stem is empty or longer than the original, returns the original lowercase.
 */
export function stemWord(word: string): string {
  // Normalize ё→е before stemming — FTS5 unicode61 doesn't treat ё as diacritic of е
  const lower = word.toLowerCase().replace(/ё/g, "е");
  const stemmer = isCyrillic(lower) ? ruStemmer : enStemmer;
  const stemmed = stemmer.stemWord(lower);

  // Guard: if stemming produced nothing or made it longer, use original
  if (!stemmed || stemmed.length > lower.length) {
    return lower;
  }

  return stemmed;
}

/**
 * Stem all words in a full text string for FTS5 index-time stemming.
 *
 * Splits on whitespace and punctuation boundaries, stems each token,
 * and reassembles into a space-separated string. Non-alphanumeric tokens
 * (punctuation, brackets, etc.) are dropped.
 *
 * Used to populate stemmed_content / stemmed_title columns so FTS5
 * indexes stemmed forms — enabling exact stem matches instead of
 * prefix-only matching at query time.
 */
/** Bilingual month mapping: English stem ↔ Russian stem.
 * At index time, both forms are emitted so cross-language queries work. */
const MONTH_EN_TO_RU: Record<string, string> = {
  januari: "январ", februari: "феврал", march: "март",
  april: "апрел", june: "июн", juli: "июл",
  august: "август", septemb: "сентябр", octob: "октябр",
  novemb: "ноябр", decemb: "декабр",
};
const MONTH_RU_TO_EN: Record<string, string> = {
  январ: "januari", феврал: "februari", март: "march",
  апрел: "april", июн: "june", июл: "juli",
  август: "august", сентябр: "septemb", октябр: "octob",
  ноябр: "novemb", декабр: "decemb",
};

export function stemText(text: string): string {
  // Split on whitespace and common separators, keep only meaningful tokens
  const tokens = text.split(/[\s\u2013\u2014\u2015—–,;:!?.…()[\]{}"'`/\\|]+/);

  const result: string[] = [];
  for (const token of tokens) {
    if (!token) continue;

    // Strip remaining non-letter/digit chars from edges (e.g. «quotes»)
    const clean = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!clean || clean.length < 2) continue;

    // Keep numbers as-is (dates, versions, IDs)
    if (/^\d+$/.test(clean)) {
      result.push(clean);
      continue;
    }

    const stemmed = stemWord(clean);
    result.push(stemmed);

    // Bilingual month expansion: emit the cross-language stem
    const ruMonth = MONTH_EN_TO_RU[stemmed];
    if (ruMonth) {
      result.push(ruMonth);
    } else {
      const enMonth = MONTH_RU_TO_EN[stemmed];
      if (enMonth) result.push(enMonth);
    }
  }

  return result.join(" ");
}
