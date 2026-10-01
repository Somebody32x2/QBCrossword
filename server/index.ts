/** HTTP entry point: JSON API under /api plus the built client. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import type { Leaderboard, MetaView, PuzzleConfig, SessionView, SubmitResult } from "../shared/types";
import { SIZES } from "../shared/taxonomy";
import { HintStore, sanitizeFilter } from "./hints";
import {
  NotEnoughCluesError,
  answers,
  buildLayout,
  dailyDate,
  dailyInfo,
  getOrCreateDaily,
  isSolved,
  newPuzzleId,
  puzzleView,
  solutionOf,
  wrongCells,
} from "./puzzles";
import { Store, type PuzzleRecord, type SessionRecord } from "./store";
import { edgeBlockList, inEdge } from "./edges";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const BASE_PATH = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
const DATA_DIR = resolve(process.env.DATA_DIR ?? "data");
const HINTS_DB = resolve(process.env.HINTS_DB ?? join(DATA_DIR, "hints.db"));
const DIST_DIR = resolve(process.env.DIST_DIR ?? "dist");
/** Reverse proxies in front of us; the client IP is read this many hops from the right of X-Forwarded-For. */
const TRUST_PROXY = Number(process.env.TRUST_PROXY ?? 0);
/** CDN header carrying the visitor address (e.g. cf-connecting-ip), trusted only from CLIENT_IP_HEADER_FROM edges. */
const CLIENT_IP_HEADER = (process.env.CLIENT_IP_HEADER ?? "").trim().toLowerCase();
const CLIENT_IP_EDGES = edgeBlockList(process.env.CLIENT_IP_HEADER_FROM ?? "");
/** Ranked daily scores accepted per IP per day, so one network cannot flood the board. */
const SCORES_PER_IP = 3;
const INITIALS = /^[A-Za-z]{3}$/;

mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(HINTS_DB)) {
  console.error(`Hint database not found at ${HINTS_DB}. Build it with: bun run ingest <backup-dir>`);
  process.exit(1);
}
const hints = new HintStore(HINTS_DB);
const store = new Store(join(DATA_DIR, "app.db"));
const saltPath = join(DATA_DIR, ".salt");
if (!existsSync(saltPath)) writeFileSync(saltPath, Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"));
const salt = readFileSync(saltPath, "utf8").trim();
const counts = hints.counts();
console.log(`Loaded ${hints.size} hints from ${HINTS_DB}`);

setInterval(() => store.pruneCustomPuzzles(), 24 * 60 * 60 * 1000).unref();
store.pruneCustomPuzzles();

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function clientIp(req: Request, server: Bun.Server<undefined>): string {
  const forwarded = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const peer =
    TRUST_PROXY > 0 && forwarded.length >= TRUST_PROXY
      ? forwarded[forwarded.length - TRUST_PROXY]!
      : (server.requestIP(req)?.address ?? "unknown");
  if (CLIENT_IP_HEADER && CLIENT_IP_EDGES && inEdge(CLIENT_IP_EDGES, peer)) {
    const visitor = req.headers.get(CLIENT_IP_HEADER)?.trim();
    if (visitor) return visitor;
  }
  return peer;
}

const hashIp = (ip: string) => new Bun.CryptoHasher("sha256").update(salt + ip).digest("hex").slice(0, 32);

const buckets = new Map<string, number[]>();
/** Sliding-window limiter for expensive endpoints (puzzle generation, session creation). */
function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) throw new HttpError(429, "Too many requests; try again in a few minutes.");
  hits.push(now);
  buckets.set(key, hits);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of buckets) if (hits.every((t) => now - t > 10 * 60 * 1000)) buckets.delete(k);
}, 60 * 1000).unref();

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, "Expected a JSON object body.");
}

function lettersFor(p: PuzzleRecord, raw: unknown): string[] {
  const n = p.layout.width * p.layout.height;
  if (!Array.isArray(raw) || raw.length !== n) throw new HttpError(400, `letters must be an array of ${n} strings.`);
  return raw.map((l) => (typeof l === "string" && /^[A-Za-z]$/.test(l) ? l.toUpperCase() : ""));
}

function cellList(p: PuzzleRecord, raw: unknown): number[] {
  const n = p.layout.width * p.layout.height;
  if (!Array.isArray(raw) || raw.length > n) throw new HttpError(400, "cells must be an array of cell indices.");
  return raw.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < n);
}

function loadPuzzle(id: string): PuzzleRecord {
  const p = store.getPuzzle(id);
  if (!p) throw new HttpError(404, "Puzzle not found.");
  return p;
}

const isLiveDaily = (p: PuzzleRecord) => p.kind === "daily" && p.date === dailyDate();

/**
 * Today's daily is only served through a session, so the clock starts the
 * moment the clues are first delivered. Returns the session, if any.
 */
function sessionFor(p: PuzzleRecord, raw: unknown): SessionRecord | null {
  if (typeof raw !== "string" || !raw) {
    if (isLiveDaily(p)) throw new HttpError(403, "Start today's puzzle to play it.");
    return null;
  }
  const s = store.getSession(raw);
  if (!s || s.puzzleId !== p.id) throw new HttpError(403, "Unknown session for this puzzle.");
  return s;
}

const sessionView = (s: SessionRecord): SessionView => ({
  id: s.id,
  startedAt: s.startedAt,
  finishedAt: s.finishedAt,
  assisted: s.assisted,
  claimed: s.claimed,
  serverNow: Date.now(),
});

function qualifies(s: SessionRecord, date: string): boolean {
  if (s.finishedAt === null || s.assisted || s.claimed) return false;
  if (store.scoresFromIp(date, s.ipHash) >= SCORES_PER_IP) return false;
  const tenth = store.tenthBest(date);
  return tenth === null || s.finishedAt - s.startedAt < tenth;
}

function leaderboard(date: string): Leaderboard {
  return {
    date,
    puzzleId: store.getDaily(date)?.id ?? null,
    entries: store.leaderboard(date).map((e, i) => ({ rank: i + 1, initials: e.initials, ms: e.ms })),
  };
}

async function api(req: Request, path: string, server: Bun.Server<undefined>): Promise<Response> {
  const method = req.method;
  const url = new URL(req.url);
  const ip = clientIp(req, server);

  if (path === "/api/health") return json({ ok: true });

  if (path === "/api/meta" && method === "GET") {
    return json({ clueCount: hints.size, counts } satisfies MetaView);
  }

  if (path === "/api/daily" && method === "GET") {
    return json(dailyInfo(await getOrCreateDaily(dailyDate(), hints, store)));
  }

  if (path === "/api/leaderboard" && method === "GET") {
    const date = url.searchParams.get("date") ?? dailyDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date must be YYYY-MM-DD.");
    return json(leaderboard(date));
  }

  if (path === "/api/sessions" && method === "POST") {
    const b = await body(req);
    const p = loadPuzzle(String(b.puzzleId ?? ""));
    if (p.kind !== "daily") throw new HttpError(400, "Only daily puzzles are timed by the server.");
    let s = typeof b.sessionId === "string" ? store.getSession(b.sessionId) : null;
    if (!s || s.puzzleId !== p.id) {
      if (!isLiveDaily(p)) throw new HttpError(403, "That daily puzzle is closed for ranking.");
      rateLimit(`session:${ip}`, 20, 10 * 60 * 1000);
      s = { id: newPuzzleId() + newPuzzleId(), puzzleId: p.id, ipHash: hashIp(ip), startedAt: Date.now(), finishedAt: null, assisted: false, claimed: false };
      store.createSession(s);
    }
    return json({ session: sessionView(s), puzzle: puzzleView(p, hints, dailyInfo(p).difficultyLabel) });
  }

  if (path === "/api/puzzles" && method === "POST") {
    const b = await body(req);
    const size = Number(b.size);
    if (!SIZES.some((s) => s.size === size)) throw new HttpError(400, "Unsupported grid size.");
    rateLimit(`generate:${ip}`, 30, 10 * 60 * 1000);
    const config: PuzzleConfig = { size, ...sanitizeFilter(b) };
    const id = newPuzzleId();
    let layout;
    try {
      layout = await buildLayout(hints, config, id);
    } catch (e) {
      if (e instanceof NotEnoughCluesError) throw new HttpError(422, e.message);
      throw e;
    }
    const record: PuzzleRecord = { id, kind: "custom", date: null, config, layout };
    store.insertPuzzle(record);
    return json(puzzleView(record, hints));
  }

  const m = /^\/api\/puzzles\/([A-Za-z0-9_-]{1,40})(?:\/(check|reveal|submit))?$/.exec(path);
  if (m) {
    const p = loadPuzzle(m[1]!);
    const action = m[2];
    if (!action && method === "GET") {
      if (isLiveDaily(p)) throw new HttpError(403, "Start today's puzzle from the daily page.");
      return json(puzzleView(p, hints, p.kind === "daily" ? dailyInfo(p).difficultyLabel : undefined));
    }
    if (method !== "POST") throw new HttpError(405, "Method not allowed.");
    const b = await body(req);
    const session = sessionFor(p, b.sessionId);

    if (action === "check") {
      const letters = lettersFor(p, b.letters);
      if (session && session.finishedAt === null) store.markAssisted(session.id);
      return json({ wrong: wrongCells(p, letters, b.cells === undefined ? undefined : cellList(p, b.cells)) });
    }

    if (action === "reveal") {
      const cells = cellList(p, b.cells);
      if (session && session.finishedAt === null) store.markAssisted(session.id);
      const solution = solutionOf(p);
      return json({ letters: Object.fromEntries(cells.filter((i) => solution[i]).map((i) => [i, solution[i]])) });
    }

    // submit
    const letters = lettersFor(p, b.letters);
    if (!isSolved(p, letters)) return json({ solved: false } satisfies SubmitResult);
    const result: SubmitResult = { solved: true, answers: answers(p, hints) };
    if (session && p.date) {
      const done = store.finishSession(session.id, Date.now())!;
      result.ms = done.finishedAt! - done.startedAt;
      result.assisted = done.assisted;
      result.claimed = done.claimed;
      result.qualifies = qualifies(done, p.date);
    }
    return json(result);
  }

  if (path === "/api/scores" && method === "POST") {
    const b = await body(req);
    const initials = typeof b.initials === "string" ? b.initials : "";
    if (!INITIALS.test(initials)) throw new HttpError(400, "Initials must be exactly 3 letters (A-Z, a-z).");
    const s = typeof b.sessionId === "string" ? store.getSession(b.sessionId) : null;
    if (!s) throw new HttpError(403, "Unknown session.");
    const p = loadPuzzle(s.puzzleId);
    if (!p.date) throw new HttpError(400, "Only daily puzzles have a scoreboard.");
    if (s.finishedAt === null) throw new HttpError(409, "Finish the puzzle first.");
    if (s.assisted) throw new HttpError(409, "Checked or revealed solves are not ranked.");
    if (s.claimed) throw new HttpError(409, "This solve is already on the board.");
    if (!qualifies(s, p.date)) throw new HttpError(409, "That time no longer makes the top 10.");
    if (!store.claimScore(s, p.date, initials, s.finishedAt - s.startedAt)) throw new HttpError(409, "This solve is already on the board.");
    return json(leaderboard(p.date));
  }

  throw new HttpError(404, "Not found.");
}

// ---------------------------------------------------------------------------
// Static client

const indexPath = join(DIST_DIR, "index.html");

async function staticFile(path: string): Promise<Response> {
  const target = normalize(join(DIST_DIR, decodeURIComponent(path)));
  if (target.startsWith(DIST_DIR + sep) && path !== "/") {
    const file = Bun.file(target);
    if (await file.exists()) {
      const immutable = path.startsWith("/assets/");
      return new Response(file, { headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600" } });
    }
    if (path.startsWith("/assets/")) return new Response("Not found", { status: 404 });
  }
  const index = Bun.file(indexPath);
  if (!(await index.exists())) return new Response("Client not built. Run: bun run build", { status: 503 });
  return new Response(index, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req, server) {
    const url = new URL(req.url);
    // Works whether or not the reverse proxy strips BASE_PATH.
    let path = url.pathname;
    if (BASE_PATH && (path === BASE_PATH || path.startsWith(BASE_PATH + "/"))) path = path.slice(BASE_PATH.length) || "/";
    try {
      if (path.startsWith("/api/")) return await api(req, path, server);
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      return await staticFile(path);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Internal error." }, 500);
    }
  },
});

console.log(`QB Crossword listening on http://${server.hostname}:${server.port}${BASE_PATH}/`);
