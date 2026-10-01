import { useEffect, useState } from "react";
import type { Leaderboard, PuzzleView, SubmitResult } from "../../../shared/types";
import { api, ApiError } from "../api";
import { LeaderboardTable } from "../components/LeaderboardTable";
import { Modal } from "../components/Modal";
import { formatMs } from "../util";

export function SolvedModal({
  puzzle,
  result,
  elapsed,
  sessionId,
  onClose,
  onClaimed,
}: {
  puzzle: PuzzleView;
  result: SubmitResult;
  elapsed: number;
  sessionId?: string;
  onClose: () => void;
  onClaimed: () => void;
}) {
  const [initials, setInitials] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const daily = puzzle.kind === "daily" && puzzle.date;
  const ms = result.ms ?? elapsed;

  useEffect(() => {
    if (daily) api.leaderboard(puzzle.date!).then(setBoard, () => setBoard(null));
  }, [daily, puzzle.date]);

  const valid = /^[A-Za-z]{3}$/.test(initials);
  const claim = async () => {
    if (!sessionId || !valid) return;
    setBusy(true);
    setError(null);
    try {
      setBoard(await api.claim(sessionId, initials));
      onClaimed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save your score.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Solved!" onClose={onClose}>
      <p className="fs-5 mb-3">
        You finished in <b className="font-monospace">{formatMs(ms)}</b>.
      </p>
      {daily && result.assisted && <p className="text-body-secondary">You checked or revealed, so this solve is unranked.</p>}
      {daily && result.qualifies && (
        <form
          className="mb-3"
          onSubmit={(e) => {
            e.preventDefault();
            void claim();
          }}
        >
          <label htmlFor="qbx-initials" className="form-label">
            You made today's top 10. Enter your initials:
          </label>
          <div className="input-group" style={{ maxWidth: "16rem" }}>
            <input
              id="qbx-initials"
              className={`form-control qbx-initials${error ? " is-invalid" : ""}`}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              autoComplete="off"
              autoFocus
              value={initials}
              onChange={(e) => setInitials(e.target.value.replace(/[^A-Za-z]/g, "").slice(0, 3))}
              placeholder="ABC"
            />
            <button className="btn btn-primary" type="submit" disabled={!valid || busy}>
              Save
            </button>
          </div>
          <div className="form-text">Three letters, A to Z.</div>
          {error && <div className="text-danger small mt-1">{error}</div>}
        </form>
      )}
      {daily && result.claimed && <p className="text-success">Your time is on the board.</p>}
      {daily && board && (
        <>
          <h6 className="mt-2">Today's leaderboard</h6>
          <LeaderboardTable entries={board.entries} highlightMs={result.claimed ? ms : undefined} compact />
        </>
      )}
      {!daily && <p className="mb-0 text-body-secondary">Each clue now shows its answer and a link to its question on QB Reader.</p>}
    </Modal>
  );
}
