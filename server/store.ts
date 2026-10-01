/** Mutable application state: stored puzzles, daily sessions and scores. */

import { Database } from "bun:sqlite";
import type { PuzzleConfig } from "../shared/types";
import type { Placement } from "./generator";

export interface StoredPlacement extends Placement {
  hintId: number;
}

export interface StoredLayout {
  width: number;
  height: number;
  /** "american": every white square crossed both ways; "freeform": packed fallback. */
  style: "american" | "freeform";
  /** Difficulty levels added on each side of the request to find a fill (0 = as asked). */
  widened: number;
  placements: StoredPlacement[];
}

export interface PuzzleRecord {
  id: string;
  kind: "daily" | "custom";
  date: string | null;
  config: PuzzleConfig;
  layout: StoredLayout;
}

export interface SessionRecord {
  id: string;
  puzzleId: string;
  ipHash: string;
  startedAt: number;
  finishedAt: number | null;
  assisted: boolean;
  claimed: boolean;
}

interface PuzzleRow {
  id: string;
  kind: "daily" | "custom";
  date: string | null;
  config: string;
  layout: string;
}

interface SessionRow {
  id: string;
  puzzle_id: string;
  ip_hash: string;
  started_at: number;
  finished_at: number | null;
  assisted: number;
  claimed: number;
}

const toPuzzle = (r: PuzzleRow): PuzzleRecord => ({
  id: r.id,
  kind: r.kind,
  date: r.date,
  config: JSON.parse(r.config) as PuzzleConfig,
  layout: JSON.parse(r.layout) as StoredLayout,
});

const toSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  puzzleId: r.puzzle_id,
  ipHash: r.ip_hash,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  assisted: r.assisted === 1,
  claimed: r.claimed === 1,
});

/** Custom puzzles nobody has opened for this long are deleted. */
const CUSTOM_PUZZLE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export class Store {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run(`CREATE TABLE IF NOT EXISTS puzzles (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      date TEXT UNIQUE,
      config TEXT NOT NULL,
      layout TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      puzzle_id TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      assisted INTEGER NOT NULL DEFAULT 0,
      claimed INTEGER NOT NULL DEFAULT 0
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      puzzle_id TEXT NOT NULL,
      date TEXT NOT NULL,
      initials TEXT NOT NULL,
      ms INTEGER NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      ip_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    this.db.run("CREATE INDEX IF NOT EXISTS scores_board ON scores (date, ms, created_at)");
  }

  insertPuzzle(p: PuzzleRecord): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT OR IGNORE INTO puzzles (id, kind, date, config, layout, created_at, last_seen)
         VALUES ($id, $kind, $date, $config, $layout, $now, $now)`,
      )
      .run({ id: p.id, kind: p.kind, date: p.date, config: JSON.stringify(p.config), layout: JSON.stringify(p.layout), now });
  }

  getPuzzle(id: string): PuzzleRecord | null {
    const row = this.db.query<PuzzleRow, [string]>("SELECT * FROM puzzles WHERE id = ?").get(id);
    if (!row) return null;
    if (row.kind === "custom") this.db.query("UPDATE puzzles SET last_seen = ? WHERE id = ?").run(Date.now(), id);
    return toPuzzle(row);
  }

  getDaily(date: string): PuzzleRecord | null {
    const row = this.db.query<PuzzleRow, [string]>("SELECT * FROM puzzles WHERE date = ?").get(date);
    return row ? toPuzzle(row) : null;
  }

  pruneCustomPuzzles(): number {
    return this.db.query("DELETE FROM puzzles WHERE kind = 'custom' AND last_seen < ?").run(Date.now() - CUSTOM_PUZZLE_TTL_MS)
      .changes;
  }

  createSession(s: SessionRecord): void {
    this.db
      .query("INSERT INTO sessions (id, puzzle_id, ip_hash, started_at) VALUES (?, ?, ?, ?)")
      .run(s.id, s.puzzleId, s.ipHash, s.startedAt);
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?").get(id);
    return row ? toSession(row) : null;
  }

  markAssisted(id: string): void {
    this.db.query("UPDATE sessions SET assisted = 1 WHERE id = ?").run(id);
  }

  /** Records the first finish only; later submissions keep the original time. */
  finishSession(id: string, at: number): SessionRecord | null {
    this.db.query("UPDATE sessions SET finished_at = ? WHERE id = ? AND finished_at IS NULL").run(at, id);
    return this.getSession(id);
  }

  /** Scores needed to beat for a top-10 place, or null while the board has room. */
  tenthBest(date: string): number | null {
    const row = this.db
      .query<{ ms: number }, [string]>("SELECT ms FROM scores WHERE date = ? ORDER BY ms, created_at LIMIT 1 OFFSET 9")
      .get(date);
    return row?.ms ?? null;
  }

  scoresFromIp(date: string, ipHash: string): number {
    return this.db
      .query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM scores WHERE date = ? AND ip_hash = ?")
      .get(date, ipHash)!.n;
  }

  /** Atomically claim a session's score; false if it was already claimed. */
  claimScore(session: SessionRecord, date: string, initials: string, ms: number): boolean {
    return this.db.transaction(() => {
      const claimed = this.db.query("UPDATE sessions SET claimed = 1 WHERE id = ? AND claimed = 0").run(session.id);
      if (claimed.changes === 0) return false;
      this.db
        .query(
          `INSERT INTO scores (puzzle_id, date, initials, ms, session_id, ip_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(session.puzzleId, date, initials, ms, session.id, session.ipHash, Date.now());
      return true;
    })();
  }

  leaderboard(date: string): Array<{ initials: string; ms: number }> {
    return this.db
      .query<{ initials: string; ms: number }, [string]>(
        "SELECT initials, ms FROM scores WHERE date = ? ORDER BY ms, created_at LIMIT 10",
      )
      .all(date);
  }
}
