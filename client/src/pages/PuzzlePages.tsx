import { useEffect, useState } from "react";
import type { DailyInfo, PuzzleView, SessionView } from "../../../shared/types";
import { ANY_DIFFICULTY } from "../../../shared/taxonomy";
import { api, ApiError } from "../api";
import { Crossword } from "../crossword/Crossword";
import { Link } from "../router";
import { formatDate, storage } from "../util";

function GridSkeleton() {
  return (
    <div className="row g-4 placeholder-glow" aria-busy="true" aria-label="Loading puzzle">
      <div className="col-lg-7">
        <span className="placeholder col-8 mb-3" style={{ height: "3rem" }} />
        <div className="placeholder w-100" style={{ aspectRatio: "1", maxWidth: "38rem" }} />
      </div>
      <div className="col-lg-5">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="placeholder col-12 mb-2" style={{ height: "3.5rem" }} />
        ))}
      </div>
    </div>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <div className="alert alert-warning" role="alert">
      {message} <Link to="/">Make a new puzzle</Link>.
    </div>
  );
}

export function DailyPage() {
  const [info, setInfo] = useState<DailyInfo | null>(null);
  const [state, setState] = useState<{ puzzle: PuzzleView; session: SessionView; offset: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = async (existing?: string) => {
    if (!info) return;
    setStarting(true);
    try {
      const res = await api.startSession(info.puzzleId, existing);
      storage.set(`session:${info.date}`, res.session.id);
      setState({ puzzle: res.puzzle, session: res.session, offset: res.session.serverNow - Date.now() });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the daily puzzle.");
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    api.daily().then(setInfo, (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load the daily puzzle."));
  }, []);

  // Resume an existing session straight away; new solvers get a start screen first.
  const existing = info ? storage.get<string | null>(`session:${info.date}`, null) : null;
  useEffect(() => {
    if (info && existing && !state) void start(existing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  if (error) return <Failure message={error} />;
  if (!info || (existing && !state)) return <GridSkeleton />;

  const header = (
    <div>
      <h1 className="h4 mb-0">Daily crossword</h1>
      <div className="text-body-secondary small">
        {formatDate(info.date)} · <span className="badge text-bg-primary fw-normal">{info.difficultyLabel}</span>
      </div>
    </div>
  );

  if (!state) {
    return (
      <div className="qbx-start">
        {header}
        <p className="mt-3" style={{ maxWidth: "60ch" }}>
          {info.weekday}'s puzzle is a {info.width}x{info.height} grid with {info.wordCount} clues at{" "}
          <b>{info.difficultyLabel}</b> difficulty. Every clue is one sentence from a quizbowl question, one that writers
          have used about that answer several times.
        </p>
        <p className="text-body-secondary small" style={{ maxWidth: "60ch" }}>
          The timer starts when you press start and keeps running on the server. Checking or revealing any letter makes your
          solve unranked.
        </p>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => void start()} disabled={starting}>
          {starting ? "Starting" : "Start"}
        </button>
      </div>
    );
  }

  return <Crossword puzzle={state.puzzle} session={state.session} clockOffset={state.offset} header={header} />;
}

export function CustomPuzzlePage({ id }: { id: string }) {
  const [puzzle, setPuzzle] = useState<PuzzleView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPuzzle(null);
    setError(null);
    api.puzzle(id).then(setPuzzle, (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load this puzzle."));
  }, [id]);

  if (error) return <Failure message={error} />;
  if (!puzzle) return <GridSkeleton />;

  const header = (
    <div>
      <h1 className="h4 mb-0">{puzzle.kind === "daily" ? `Daily crossword, ${formatDate(puzzle.date!)}` : "Crossword"}</h1>
      <div className="text-body-secondary small">
        {puzzle.width}x{puzzle.height} · {puzzle.clues.length} clues ·{" "}
        <span className="badge text-bg-primary fw-normal">{puzzle.difficultyLabel}</span>
        {puzzle.widened > 0 && (
          <span className="ms-1" title="No full grid could be filled at the requested levels, so nearby levels were allowed.">
            {puzzle.widened >= ANY_DIFFICULTY ? "(any difficulty)" : `(widened ±${puzzle.widened})`}
          </span>
        )}
        {puzzle.style === "freeform" && <span className="ms-1">· loose grid</span>}
        {puzzle.config.categories.length > 0 && <> · {puzzle.config.categories.join(", ")}</>}
        {puzzle.kind === "custom" && (
          <button
            type="button"
            className="btn btn-link btn-sm p-0 ms-2 align-baseline"
            onClick={() => void navigator.clipboard?.writeText(window.location.href)}
            title="Copy a link to this puzzle"
          >
            <i className="bi bi-link-45deg" /> Copy link
          </button>
        )}
      </div>
    </div>
  );
  return <Crossword key={puzzle.id} puzzle={puzzle} header={header} />;
}
