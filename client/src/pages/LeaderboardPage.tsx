import { useEffect, useState } from "react";
import type { DailyInfo, Leaderboard } from "../../../shared/types";
import { api } from "../api";
import { LeaderboardTable } from "../components/LeaderboardTable";
import { Link } from "../router";
import { formatDate } from "../util";

const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function LeaderboardPage() {
  const [today, setToday] = useState<DailyInfo | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.daily().then(
      (d) => {
        setToday(d);
        setDate(d.date);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(() => {
    if (!date) return;
    setBoard(null);
    api.leaderboard(date).then(setBoard, () => setFailed(true));
  }, [date]);

  if (failed) return <div className="alert alert-warning">Could not load the leaderboard.</div>;

  const isToday = date === today?.date;
  return (
    <div style={{ maxWidth: "40rem" }}>
      <h1 className="h3">Leaderboard</h1>
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <button type="button" className="btn btn-outline-secondary btn-sm" disabled={!date} onClick={() => date && setDate(shiftDate(date, -1))} aria-label="Previous day">
          <i className="bi bi-chevron-left" />
        </button>
        <input
          type="date"
          className="form-control form-control-sm"
          style={{ width: "11rem" }}
          value={date ?? ""}
          max={today?.date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={!date || isToday}
          onClick={() => date && setDate(shiftDate(date, 1))}
          aria-label="Next day"
        >
          <i className="bi bi-chevron-right" />
        </button>
        {!isToday && today && (
          <button type="button" className="btn btn-link btn-sm" onClick={() => setDate(today.date)}>
            Today
          </button>
        )}
      </div>
      {date && <h2 className="h6 text-body-secondary">{formatDate(date)}</h2>}
      {board ? <LeaderboardTable entries={board.entries} /> : <p className="text-body-secondary">Loading...</p>}
      {board?.puzzleId && (
        <p className="mt-3 small">
          {isToday ? <Link to="/daily">Play today's puzzle</Link> : <Link to={`/p/${board.puzzleId}`}>Play this day's puzzle (unranked)</Link>}
        </p>
      )}
    </div>
  );
}
