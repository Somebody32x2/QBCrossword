/** Tossup text processing: power-mark removal, answer redaction, sentence splitting. */

import { toLetters } from "./answerline";

export const REDACTION = "____";

// Null prototype so words like "constructor" are not found on Object.prototype.
const wordTable = (words: string): Record<string, true> =>
  Object.assign(Object.create(null), Object.fromEntries(words.split(" ").map((w) => [w, true] as const)));

const ABBREVIATIONS = wordTable(
  "mr mrs ms dr st mt jr sr vs etc eg ie no nos vol vols ch gen col lt sgt capt cmdr adm rev prof gov sen rep pres " +
    "ft co corp inc ltd approx ca c fl b d op pp cf al ave blvd jan feb mar apr jun jul aug sep sept oct nov dec " +
    "messrs mme mlle fig figs ed eds trans esp var subsp sp spp dept univ assn bros est",
);

const STOPWORDS = wordTable(
  "the a an of and or in on at to for with from by de la le les el los las du des der die das van von y et",
);

/** Split tossup text into sentences, keeping abbreviations and initials intact. */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let start = 0;
  const boundary = /[.!?]["”’)\]]*\s+(?=["“‘(\[]?[A-Z0-9])/g;
  for (const m of clean.matchAll(boundary)) {
    const end = m.index + m[0].trimEnd().length;
    const before = clean.slice(start, m.index);
    const lastToken = /([A-Za-z.]+)$/.exec(before)?.[1] ?? "";
    const bare = lastToken.replace(/\./g, "").toLowerCase();
    // Initials ("J. S. Bach", "U.S.") and known abbreviations do not end sentences.
    if (clean[m.index] === "." && (/^[A-Z]$/.test(lastToken) || lastToken.includes(".") || ABBREVIATIONS[bare])) continue;
    out.push(clean.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  if (start < clean.length) out.push(clean.slice(start).trim());

  // Fold tiny fragments ("Ha!") into the previous sentence.
  const merged: string[] = [];
  for (const s of out) {
    if (merged.length > 0 && s.split(" ").length < 4) merged[merged.length - 1] += " " + s;
    else merged.push(s);
  }
  return merged.filter(Boolean);
}

/**
 * Blank out words of the answer that appear in the question, so a clue never
 * spells out its own entry. Matching is case- and diacritic-insensitive.
 */
export function redactAnswer(text: string, answerWords: string[]): string {
  const targets = new Set<string>();
  for (const phrase of answerWords) {
    for (const w of phrase.split(/[\s\-–—/]+/)) {
      const letters = toLetters(w);
      if (letters.length >= 3 && !STOPWORDS[w.toLowerCase()]) targets.add(letters);
    }
  }
  if (targets.size === 0) return text;
  return text.replace(/[\p{L}\p{M}'’]+/gu, (word) => {
    const letters = toLetters(word);
    for (const t of targets) {
      if (letters === t || letters === t + "S" || letters === t + "ES") return REDACTION;
      if (letters.startsWith(t) && t.length >= 5) return REDACTION;
    }
    return word;
  });
}

export function prepareQuestion(questionSanitized: string, answerWords: string[]): string[] {
  const text = questionSanitized.replace(/\(\s*[*+]\s*\)/g, " ").replace(/\s+/g, " ").trim();
  return splitSentences(redactAnswer(text, answerWords));
}
