/** Read-only access to the clue database built by scripts/ingest.ts. */

import { Database } from "bun:sqlite";
import type { Rng } from "./generator";
import { TAXONOMY } from "../shared/taxonomy";

export interface ClueFilter {
  difficulties: number[];
  categories: string[];
  subcategories: string[];
  alternateSubcategories: string[];
}

export interface ClueRow {
  id: string;
  entry: string;
  enumeration: string;
  display: string;
  answer: string;
  difficulty: number;
  category: string;
  subcategory: string;
  alternate_subcategory: string | null;
  set_name: string;
  year: number | null;
  sentences: string;
}

interface IndexRow {
  rowid: number;
  entry: string;
  difficulty: number;
  category: string;
  subcategory: string;
  alternate_subcategory: string | null;
}

export class ClueStore {
  private readonly db: Database;
  private readonly rows: IndexRow[];
  private readonly byId;
  private readonly byRowidQuery;

  constructor(path: string) {
    this.db = new Database(path, { readonly: true });
    this.rows = this.db
      .query<IndexRow, []>("SELECT rowid, entry, difficulty, category, subcategory, alternate_subcategory FROM clues")
      .all();
    this.byId = this.db.query<ClueRow, [string]>("SELECT * FROM clues WHERE id = ?");
    this.byRowidQuery = this.db.query<ClueRow, [number]>("SELECT * FROM clues WHERE rowid = ?");
  }

  get size(): number {
    return this.rows.length;
  }

  /** Tossup counts per category/subcategory/alternate, for the subject picker. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.rows) {
      for (const key of [r.category, `${r.category}/${r.subcategory}`, `${r.category}/${r.subcategory}/${r.alternate_subcategory}`]) {
        out[key] = (out[key] ?? 0) + 1;
      }
    }
    return out;
  }

  /**
   * Distinct entries matching the filter, in a weighted random order: entries
   * asked about more often (better-known answers) tend to come first.
   * Returns the order plus the matching row ids for each entry.
   */
  candidates(filter: ClueFilter, maxLength: number, rng: Rng): { order: string[]; rowids: Map<string, number[]> } {
    const difficulties = new Set(filter.difficulties);
    const categories = new Set(filter.categories);
    const subcategories = new Set(filter.subcategories);
    const alternates = new Set(filter.alternateSubcategories);
    const rowids = new Map<string, number[]>();
    for (const r of this.rows) {
      if (r.entry.length > maxLength) continue;
      if (difficulties.size && !difficulties.has(r.difficulty)) continue;
      if (categories.size && !categories.has(r.category)) continue;
      if (subcategories.size && !subcategories.has(r.subcategory)) continue;
      if (alternates.size && r.alternate_subcategory && !alternates.has(r.alternate_subcategory)) continue;
      const list = rowids.get(r.entry);
      if (list) list.push(r.rowid);
      else rowids.set(r.entry, [r.rowid]);
    }
    // Efraimidis-Spirakis weighted order, weight = sqrt(times asked).
    const keyed = [...rowids].map(([entry, ids]) => ({ entry, key: Math.pow(rng(), 1 / Math.sqrt(ids.length)) }));
    keyed.sort((a, b) => b.key - a.key);
    return { order: keyed.map((k) => k.entry), rowids };
  }

  byRowid(rowid: number): ClueRow | null {
    return this.byRowidQuery.get(rowid);
  }

  get(id: string): ClueRow | null {
    return this.byId.get(id);
  }
}

/** Keep only known taxonomy values; unknown strings are dropped rather than rejected. */
export function sanitizeFilter(input: Partial<Record<keyof ClueFilter, unknown>>): ClueFilter {
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
