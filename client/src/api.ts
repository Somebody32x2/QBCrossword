import type {
  DailyInfo,
  Leaderboard,
  MetaView,
  PuzzleConfig,
  PuzzleView,
  SessionView,
  SubmitResult,
} from "../../shared/types";

/**
 * Mount point of this page. Assets are built under BASE_PATH (e.g. /qbcrossword),
 * but an alias domain can serve the app at its root, so detect which one we are on.
 */
const BUILT_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const BASE =
  window.location.pathname === BUILT_BASE || window.location.pathname.startsWith(`${BUILT_BASE}/`) ? BUILT_BASE : "";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`);
  return data as T;
}

export const api = {
  meta: () => request<MetaView>("GET", "/meta"),
  daily: () => request<DailyInfo>("GET", "/daily"),
  leaderboard: (date?: string) => request<Leaderboard>("GET", `/leaderboard${date ? `?date=${date}` : ""}`),
  startSession: (puzzleId: string, sessionId?: string) =>
    request<{ session: SessionView; puzzle: PuzzleView }>("POST", "/sessions", { puzzleId, sessionId }),
  generate: (config: PuzzleConfig) => request<PuzzleView>("POST", "/puzzles", config),
  puzzle: (id: string) => request<PuzzleView>("GET", `/puzzles/${encodeURIComponent(id)}`),
  check: (id: string, letters: string[], cells: number[] | undefined, sessionId?: string) =>
    request<{ wrong: number[] }>("POST", `/puzzles/${encodeURIComponent(id)}/check`, { letters, cells, sessionId }),
  reveal: (id: string, cells: number[], sessionId?: string) =>
    request<{ letters: Record<string, string> }>("POST", `/puzzles/${encodeURIComponent(id)}/reveal`, { cells, sessionId }),
  submit: (id: string, letters: string[], sessionId?: string) =>
    request<SubmitResult>("POST", `/puzzles/${encodeURIComponent(id)}/submit`, { letters, sessionId }),
  claim: (sessionId: string, initials: string) => request<Leaderboard>("POST", "/scores", { sessionId, initials }),
};
