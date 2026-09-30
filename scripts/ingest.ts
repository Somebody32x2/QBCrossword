/**
 * Builds the clue database from an official QB Reader backup
 * (https://www.qbreader.org/db/backups).
 *
 *   bun run ingest <path/to/tossups.json> [out.db]
 *
 * `tossups.json` is the MongoDB extended-JSON export inside the backup archive,
 * one document per line.
 */

import { Database } from "bun:sqlite";
import { createReadStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseAnswerline } from "../shared/answerline";
import { prepareQuestion } from "../shared/cluetext";
import { TAXONOMY } from "../shared/taxonomy";

const [input, outArg] = process.argv.slice(2);
if (!input) {
  console.error("usage: bun run ingest <tossups.json> [out.db]");
  process.exit(1);
}
const out = resolve(outArg ?? resolve(process.env.DATA_DIR ?? "data", "clues.db"));
const tmp = `${out}.tmp`;
mkdirSync(dirname(out), { recursive: true });
rmSync(tmp, { force: true });

type Ext<T> = T | { $numberInt: string } | { $numberLong: string } | { $oid: string };
const unwrap = (v: Ext<unknown>): unknown =>
  v && typeof v === "object" ? (Object.values(v as Record<string, unknown>)[0] as unknown) : v;

interface RawTossup {
  _id: Ext<string>;
  question_sanitized?: string;
  answer?: string;
  answer_sanitized?: string;
  category?: string;
  subcategory?: string;
  alternate_subcategory?: string;
  difficulty?: Ext<number>;
  set?: { name?: string; year?: Ext<number>; standard?: boolean };
}

const db = new Database(tmp, { create: true });
db.run("PRAGMA journal_mode = OFF");
db.run("PRAGMA synchronous = OFF");
db.run(`CREATE TABLE clues (
  id TEXT PRIMARY KEY,
  entry TEXT NOT NULL,
  enumeration TEXT NOT NULL,
  canonical TEXT NOT NULL,
  display TEXT NOT NULL,
  answer TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  alternate_subcategory TEXT,
  set_name TEXT NOT NULL,
  year INTEGER,
  standard INTEGER NOT NULL,
  sentences TEXT NOT NULL
)`);
const insert = db.prepare(`INSERT OR IGNORE INTO clues VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

let seen = 0;
let kept = 0;
const insertMany = db.transaction((docs: RawTossup[]) => {
  for (const t of docs) {
    seen++;
    const parsed = parseAnswerline(t.answer ?? "");
    if (!parsed || !t.question_sanitized || !t.category || !t.subcategory) continue;
    // Drop mislabelled rows; alternate subcategories only exist where QB Reader defines them.
    const alternates = TAXONOMY[t.category]?.[t.subcategory];
    if (!alternates) continue;
    const alternate = t.alternate_subcategory && alternates.includes(t.alternate_subcategory) ? t.alternate_subcategory : null;
    if (alternates.length > 0 && !alternate) continue;
    const sentences = prepareQuestion(t.question_sanitized, [parsed.canonical, parsed.display]);
    const words = sentences.join(" ").split(" ").length;
    if (sentences.length === 0 || words < 20) continue;
    const difficulty = Number(unwrap(t.difficulty ?? 0));
    const year = t.set?.year === undefined ? null : Number(unwrap(t.set.year));
    insert.run(
      String(unwrap(t._id)),
      parsed.entry,
      parsed.enumeration,
      parsed.canonical,
      parsed.display,
      (t.answer_sanitized ?? parsed.display).trim(),
      Number.isFinite(difficulty) ? difficulty : 0,
      t.category,
      t.subcategory,
      alternate,
      t.set?.name ?? "",
      year,
      t.set?.standard === false ? 0 : 1,
      JSON.stringify(sentences),
    );
    kept++;
  }
});

let batch: RawTossup[] = [];
for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
  if (line.trim()) batch.push(JSON.parse(line) as RawTossup);
  if (batch.length >= 5000) {
    insertMany(batch);
    batch = [];
  }
}
insertMany(batch);

db.run("CREATE INDEX clues_filter ON clues (difficulty, category, subcategory)");
db.run("CREATE INDEX clues_entry ON clues (entry)");
db.run("ANALYZE");
insert.finalize();
db.close();
renameSync(tmp, out);
console.log(`${seen} read, ${kept} kept -> ${out}`);
