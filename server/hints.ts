/** Read-only access to the hint database built by scripts/ingest.ts. */

import { Database } from "bun:sqlite";
import type { Rng } from "./generator";
import { TAXONOMY } from "../shared/taxonomy";

export interface HintFilter {
  difficulties: number[];
  categories: string[];
  subcategories: string[];
  alternateSubcategories: string[];
}

export interface HintRow {
  id: number;
  entry: string;
  text: string;
  difficulty: number;
  source_difficulty: number;
  support: number;
  popularity: number;
  category: string;
  subcategory: string;
  alternate_subcategory: string | null;
  source_type: "tossup" | "bonus";
  source_id: string;
  set_name: string;
  enumeration: string;
  display: string;
  answer: string;
}

export interface Candidates {
  /** Distinct entries, better-known answers tending to come first. */
  order: string[];
  /** Matching hint ids and their support, per entry. */
  hints: Map<string, Array<{ id: number; support: number }>>;
}

/** Interns strings into small integer codes for the compact in-memory index. */
class Codes {
  readonly values: string[] = [];
  private readonly ids = new Map<string, number>();
  code(v: string): number {
    let id = this.ids.get(v);
    if (id === undefined) {
      id = this.values.length;
      this.ids.set(v, id);
      this.values.push(v);
    }
    return id;
  }
  find(v: string): number | undefined {
    return this.ids.get(v);
  }
}

export class HintStore {
  private readonly db: Database;
  private readonly byId;
  // Column-oriented index of every hint, ~600k rows.
  private readonly ids: Int32Array;
  private readonly entry: Int32Array;
  private readonly difficulty: Int8Array;
  private readonly category: Int16Array;
  private readonly subcategory: Int16Array;
  private readonly alternate: Int16Array;
  private readonly support: Int32Array;
  private readonly popularity: Int32Array;
  private readonly entries = new Codes();
  private readonly labels = new Codes();

  constructor(path: string) {
    this.db = new Database(path, { readonly: true });
    const n = this.db.query<{ n: number }, []>("SELECT count(*) AS n FROM hints").get()!.n;
    this.ids = new Int32Array(n);
    this.entry = new Int32Array(n);
    this.difficulty = new Int8Array(n);
    this.category = new Int16Array(n);
    this.subcategory = new Int16Array(n);
    this.alternate = new Int16Array(n);
    this.support = new Int32Array(n);
    this.popularity = new Int32Array(n);
    let i = 0;
    const rows = this.db.query<
      Pick<HintRow, "id" | "entry" | "difficulty" | "category" | "subcategory" | "alternate_subcategory" | "support" | "popularity">,
      []
    >("SELECT id, entry, difficulty, category, subcategory, alternate_subcategory, support, popularity FROM hints");
    for (const r of rows.iterate()) {
      this.ids[i] = r.id;
      this.entry[i] = this.entries.code(r.entry);
      this.difficulty[i] = r.difficulty;
      this.category[i] = this.labels.code(r.category);
      this.subcategory[i] = this.labels.code(r.subcategory);
      this.alternate[i] = r.alternate_subcategory ? this.labels.code(r.alternate_subcategory) : -1;
      this.support[i] = r.support;
      this.popularity[i] = r.popularity;
      i++;
    }
    this.byId = this.db.query<HintRow, [number]>("SELECT * FROM hints WHERE id = ?");
  }

  get size(): number {
    return this.ids.length;
  }

  /** Hint counts per category, category/subcategory and category/subcategory/alternate. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = 0; i < this.ids.length; i++) {
      const cat = this.labels.values[this.category[i]!]!;
      const sub = `${cat}/${this.labels.values[this.subcategory[i]!]}`;
      const keys = [cat, sub];
      if (this.alternate[i]! >= 0) keys.push(`${sub}/${this.labels.values[this.alternate[i]!]}`);
      for (const k of keys) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  candidates(filter: HintFilter, maxLength: number, rng: Rng): Candidates {
    const codes = (values: string[]) => new Set(values.map((v) => this.labels.find(v) ?? -2));
    const difficulties = new Set(filter.difficulties);
    const categories = codes(filter.categories);
    const subcategories = codes(filter.subcategories);
    const alternates = codes(filter.alternateSubcategories);
    const hints = new Map<string, Array<{ id: number; support: number }>>();
    const popularity = new Map<string, number>();
    for (let i = 0; i < this.ids.length; i++) {
      if (difficulties.size && !difficulties.has(this.difficulty[i]!)) continue;
      if (categories.size && !categories.has(this.category[i]!)) continue;
      if (subcategories.size && !subcategories.has(this.subcategory[i]!)) continue;
      if (alternates.size && this.alternate[i]! >= 0 && !alternates.has(this.alternate[i]!)) continue;
      const entry = this.entries.values[this.entry[i]!]!;
      if (entry.length > maxLength) continue;
      const list = hints.get(entry);
      const hint = { id: this.ids[i]!, support: this.support[i]! };
      if (list) list.push(hint);
      else {
        hints.set(entry, [hint]);
        popularity.set(entry, this.popularity[i]!);
      }
    }
    // Efraimidis-Spirakis weighted order, weight = sqrt(questions asked on the answer).
    const keyed = [...popularity].map(([entry, p]) => ({ entry, key: Math.pow(rng(), 1 / Math.sqrt(p)) }));
    keyed.sort((a, b) => b.key - a.key);
    return { order: keyed.map((k) => k.entry), hints };
  }

  /** A hint for the entry, favouring the most commonly repeated clues. */
  pick(options: Array<{ id: number; support: number }>, rng: Rng): number {
    let total = 0;
    for (const o of options) total += o.support;
    let x = rng() * total;
    for (const o of options) {
      x -= o.support;
      if (x <= 0) return o.id;
    }
    return options[options.length - 1]!.id;
  }

  get(id: number): HintRow | null {
    return this.byId.get(id);
  }
}

/** Keep only known taxonomy values; unknown strings are dropped rather than rejected. */
export function sanitizeFilter(input: Partial<Record<keyof HintFilter, unknown>>): HintFilter {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const categories = strings(input.categories).filter((c) => TAXONOMY[c]);
  const allSubs = Object.values(TAXONOMY).flatMap((subs) => Object.keys(subs));
  const allAlts = Object.values(TAXONOMY).flatMap((subs) => Object.values(subs).flat());
  const difficulties = Array.isArray(input.difficulties)
    ? input.difficulties.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 10)
    : [];
  return {
    difficulties: [...new Set(difficulties)].sort((a, b) => a - b),
    categories: [...new Set(categories)],
    subcategories: [...new Set(strings(input.subcategories).filter((s) => allSubs.includes(s)))],
    alternateSubcategories: [...new Set(strings(input.alternateSubcategories).filter((s) => allAlts.includes(s)))],
  };
}
