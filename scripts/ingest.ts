/**
 * Builds the hint database from an official QB Reader backup
 * (https://www.qbreader.org/db/backups).
 *
 *   bun run ingest <backup-dir> [out.db]
 *
 * <backup-dir> holds `tossups.json` and `bonuses.json`, the MongoDB
 * extended-JSON exports from the archive (one document per line).
 *
 * Every hint is a single sentence about an answer. A sentence is kept only if
 * its clue is common: at least MIN_SUPPORT other questions on the same answer
 * contain a sentence giving the same clue (shared distinctive words).
 */

import { Database } from "bun:sqlite";
import { createReadStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseAnswerline, type ParsedAnswer } from "../shared/answerline";
import { clueTokens, questionSentences, toHint } from "../shared/cluetext";
import { TAXONOMY } from "../shared/taxonomy";

const [inputDir, outArg] = process.argv.slice(2);
if (!inputDir) {
  console.error("usage: bun run ingest <backup-dir> [out.db]");
  process.exit(1);
}
const out = resolve(outArg ?? resolve(process.env.DATA_DIR ?? "data", "hints.db"));

/** A clue must appear in this many other distinct questions on the same answer ("not used only once or twice"). */
const MIN_SUPPORT = 2;
/** Tokens in more than this share of all sentences are too generic to identify a clue. */
const GENERIC_SHARE = 0.003;
/** Sentence position moves difficulty by up to this much: lead-ins harder, giveaways easier. */
const MAX_SHIFT = 3;

type Ext<T> = T | { $numberInt: string } | { $oid: string };
const unwrap = (v: Ext<unknown>): unknown =>
  v && typeof v === "object" ? (Object.values(v as Record<string, unknown>)[0] as unknown) : v;

interface RawQuestion {
  _id: Ext<string>;
  category?: string;
  subcategory?: string;
  alternate_subcategory?: string;
  difficulty?: Ext<number>;
  set?: { name?: string };
  // tossups
  question_sanitized?: string;
  answer?: string;
  answer_sanitized?: string;
  // bonuses
  parts_sanitized?: string[];
  answers?: string[];
  answers_sanitized?: string[];
  difficultyModifiers?: string[];
}

interface Question {
  entry: string;
  type: "tossup" | "bonus";
  sourceId: string;
  category: string;
  subcategory: string;
  alternate: string | null;
  setName: string;
  enumeration: string;
  display: string;
  answer: string;
}

interface Sentence {
  q: number;
  tokens: Int32Array;
  hint: string | null;
  difficulty: number;
  sourceDifficulty: number;
}

const questions: Question[] = [];
const sentences: Sentence[] = [];
const byEntry = new Map<string, number[]>(); // entry -> sentence indices
const seenText = new Set<string>();
const tokenIds = new Map<string, number>();
const tokenDf: number[] = [];

function taxonomy(raw: RawQuestion): { alternate: string | null } | null {
  const alternates = raw.category && raw.subcategory ? TAXONOMY[raw.category]?.[raw.subcategory] : undefined;
  if (!alternates) return null;
  const alternate = raw.alternate_subcategory && alternates.includes(raw.alternate_subcategory) ? raw.alternate_subcategory : null;
  if (alternates.length > 0 && !alternate) return null;
  return { alternate };
}

const clampDifficulty = (source: number, shift: number) => (source === 0 ? 0 : Math.max(1, Math.min(10, source + shift)));

function addQuestion(raw: RawQuestion, type: Question["type"], parsed: ParsedAnswer, text: string, answer: string, shifts: (i: number, n: number) => number) {
  const tax = taxonomy(raw);
  if (!tax) return;
  // Mirrors of the same question count once.
  const fingerprint = `${parsed.entry}|${Bun.hash(text.toLowerCase().replace(/[^a-z]/g, ""))}`;
  if (seenText.has(fingerprint)) return;
  seenText.add(fingerprint);

  const sourceDifficulty = Number(unwrap(raw.difficulty ?? 0)) || 0;
  const q = questions.length;
  questions.push({
    entry: parsed.entry,
    type,
    sourceId: String(unwrap(raw._id)),
    category: raw.category!,
    subcategory: raw.subcategory!,
    alternate: tax.alternate,
    setName: raw.set?.name ?? "",
    enumeration: parsed.enumeration,
    display: parsed.display,
    answer,
  });
  const parts = questionSentences(text);
  const list = byEntry.get(parsed.entry) ?? [];
  parts.forEach((s, i) => {
    const ids = clueTokens(s).map((t) => {
      let id = tokenIds.get(t);
      if (id === undefined) {
        id = tokenDf.length;
        tokenIds.set(t, id);
        tokenDf.push(0);
      }
      tokenDf[id]!++;
      return id;
    });
    list.push(sentences.length);
    sentences.push({
      q,
      tokens: Int32Array.from(ids),
      hint: toHint(s, [parsed.canonical, parsed.display]),
      difficulty: clampDifficulty(sourceDifficulty, shifts(i, parts.length)),
      sourceDifficulty,
    });
  });
  byEntry.set(parsed.entry, list);
}

async function* lines(path: string): AsyncGenerator<RawQuestion> {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (line.trim()) yield JSON.parse(line) as RawQuestion;
  }
}

const MODIFIER_SHIFT: Record<string, number> = { e: -1, m: 0, h: 1 };

let tossups = 0;
for await (const t of lines(join(inputDir, "tossups.json"))) {
  tossups++;
  const parsed = parseAnswerline(t.answer ?? "");
  if (!parsed || !t.question_sanitized) continue;
  addQuestion(t, "tossup", parsed, t.question_sanitized, (t.answer_sanitized ?? parsed.display).trim(), (i, n) =>
    n > 1 ? Math.round(MAX_SHIFT - (2 * MAX_SHIFT * i) / (n - 1)) : 0,
  );
}
let parts = 0;
for await (const b of lines(join(inputDir, "bonuses.json"))) {
  b.parts_sanitized?.forEach((part, i) => {
    parts++;
    const parsed = parseAnswerline(b.answers?.[i] ?? "");
    if (!parsed || !part) return;
    const shift = MODIFIER_SHIFT[b.difficultyModifiers?.[i] ?? ""] ?? 0;
    addQuestion(b, "bonus", parsed, part, (b.answers_sanitized?.[i] ?? parsed.display).trim(), () => shift);
  });
}
console.log(`${tossups} tossups, ${parts} bonus parts -> ${questions.length} distinct questions, ${sentences.length} sentences`);

// ---------------------------------------------------------------------------
// Clue support: how many other questions on the same answer repeat the clue.

const genericCap = Math.max(50, sentences.length * GENERIC_SHARE);
const distinctive = (s: Sentence) => s.tokens.filter((t) => tokenDf[t]! <= genericCap);

interface HintRow {
  sentence: Sentence;
  support: number;
}
const hints: HintRow[] = [];
const popularity = new Map<string, number>();

for (const [entry, ids] of byEntry) {
  popularity.set(entry, new Set(ids.map((i) => sentences[i]!.q)).size);
  if (!ids.some((i) => sentences[i]!.hint)) continue;
  const toks = ids.map((i) => distinctive(sentences[i]!));
  const postings = new Map<number, number[]>();
  toks.forEach((ts, local) => {
    for (const t of ts) {
      const list = postings.get(t);
      if (list) list.push(local);
      else postings.set(t, [local]);
    }
  });
  const seenHints = new Set<string>();
  ids.forEach((id, local) => {
    const s = sentences[id]!;
    if (!s.hint || seenHints.has(s.hint)) return;
    const mine = toks[local]!;
    if (mine.length < 2) return;
    const shared = new Map<number, number>();
    for (const t of mine) for (const other of postings.get(t)!) if (sentences[ids[other]!]!.q !== s.q) shared.set(other, (shared.get(other) ?? 0) + 1);
    const supporters = new Set<number>();
    for (const [other, n] of shared) {
      if (n >= 2 && n >= 0.3 * Math.min(mine.length, toks[other]!.length)) supporters.add(sentences[ids[other]!]!.q);
    }
    if (supporters.size < MIN_SUPPORT) return;
    seenHints.add(s.hint);
    hints.push({ sentence: s, support: supporters.size });
  });
}

// ---------------------------------------------------------------------------

const tmp = `${out}.tmp`;
mkdirSync(dirname(out), { recursive: true });
rmSync(tmp, { force: true });
const db = new Database(tmp, { create: true });
db.run("PRAGMA journal_mode = OFF");
db.run("PRAGMA synchronous = OFF");
db.run(`CREATE TABLE hints (
  id INTEGER PRIMARY KEY,
  entry TEXT NOT NULL,
  text TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  source_difficulty INTEGER NOT NULL,
  support INTEGER NOT NULL,
  popularity INTEGER NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  alternate_subcategory TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  set_name TEXT NOT NULL,
  enumeration TEXT NOT NULL,
  display TEXT NOT NULL,
  answer TEXT NOT NULL
)`);
const insert = db.prepare(`INSERT INTO hints (entry, text, difficulty, source_difficulty, support, popularity, category, subcategory,
  alternate_subcategory, source_type, source_id, set_name, enumeration, display, answer) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
db.transaction(() => {
  for (const { sentence: s, support } of hints) {
    const q = questions[s.q]!;
    insert.run(q.entry, s.hint, s.difficulty, s.sourceDifficulty, support, popularity.get(q.entry)!, q.category, q.subcategory,
      q.alternate, q.type, q.sourceId, q.setName, q.enumeration, q.display, q.answer);
  }
})();
db.run("CREATE INDEX hints_entry ON hints (entry)");
db.run("ANALYZE");
insert.finalize();
db.close();
renameSync(tmp, out);
console.log(`${hints.length} common hints for ${new Set(hints.map((h) => questions[h.sentence.q]!.entry)).size} answers -> ${out}`);
