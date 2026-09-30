import { useEffect, useState } from "react";
import type { DailyInfo, Leaderboard, MetaView, PuzzleConfig } from "../../../shared/types";
import { DIFFICULTIES, DIFFICULTY_PRESETS, SIZES } from "../../../shared/taxonomy";
import { api, ApiError } from "../api";
import { Dropdown } from "../components/Dropdown";
import { LeaderboardTable } from "../components/LeaderboardTable";
import { ALL_SUBJECTS, SubjectPicker, describeSubjects, subjectFilter, type SubjectSelection } from "../components/SubjectPicker";
import { Link, navigate } from "../router";
import { formatDate, storage } from "../util";

interface Settings {
  size: number;
  difficulties: number[];
  subjects: SubjectSelection;
}

export interface RecentPuzzle {
  id: string;
  label: string;
  size: number;
  created: number;
}

const DEFAULT_SETTINGS: Settings = { size: 15, difficulties: [3, 4], subjects: ALL_SUBJECTS };

export function difficultySummary(ds: number[]): string {
  if (ds.length === 0) return "Any difficulty";
  const preset = DIFFICULTY_PRESETS.find((p) => p.difficulties.length === ds.length && p.difficulties.every((d) => ds.includes(d)));
  if (preset) return preset.label;
  return ds.length === 1 ? DIFFICULTIES.find(([d]) => d === ds[0])![1] : `Levels ${ds.join(", ")}`;
}

export function Home() {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...storage.get<Partial<Settings>>("settings", {}) }));
  const [daily, setDaily] = useState<DailyInfo | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [meta, setMeta] = useState<MetaView | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent] = useState(() => storage.get<RecentPuzzle[]>("recent", []));

  useEffect(() => storage.set("settings", settings), [settings]);
  useEffect(() => {
    api.daily().then(setDaily, () => setDaily(null));
    api.leaderboard().then(setBoard, () => setBoard(null));
    api.meta().then(setMeta, () => setMeta(null));
  }, []);

  const toggleDifficulty = (d: number) =>
    setSettings((s) => ({
      ...s,
      difficulties: s.difficulties.includes(d) ? s.difficulties.filter((x) => x !== d) : [...s.difficulties, d].sort((a, b) => a - b),
    }));

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const config: PuzzleConfig = { size: settings.size, difficulties: settings.difficulties, ...subjectFilter(settings.subjects) };
      const p = await api.generate(config);
      const entry: RecentPuzzle = { id: p.id, label: `${difficultySummary(settings.difficulties)} · ${describeSubjects(settings.subjects)}`, size: settings.size, created: Date.now() };
      storage.set("recent", [entry, ...storage.get<RecentPuzzle[]>("recent", []).filter((r) => r.id !== p.id)].slice(0, 8));
      navigate(`/p/${p.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not build a puzzle.");
      setBusy(false);
    }
  };

  const dailyProgress = daily ? storage.get<{ result?: { solved?: boolean } } | null>(`progress:${daily.puzzleId}`, null) : null;
  const dailyStarted = daily ? storage.get<string | null>(`session:${daily.date}`, null) !== null : false;

  return (
    <div className="row g-4">
      <div className="col-lg-7">
        <section className="mb-4">
          <h1 className="h3 mb-1">Daily crossword</h1>
          {daily ? (
            <>
              <p className="text-body-secondary mb-3">{formatDate(daily.date)}</p>
              <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                <span className="badge text-bg-primary fs-6 fw-normal">{daily.difficultyLabel}</span>
                <span className="badge text-bg-secondary fw-normal">
                  {daily.width}x{daily.height}
                </span>
                <span className="badge text-bg-secondary fw-normal">{daily.wordCount} clues</span>
              </div>
              <p className="mb-3" style={{ maxWidth: "60ch" }}>
                Everyone gets the same grid. The clock starts when you open it, and clean solves (no checks or reveals) go on
                the leaderboard.
              </p>
              <Link to="/daily" className="btn btn-primary">
                {dailyProgress?.result?.solved ? "View solved puzzle" : dailyStarted ? "Continue" : "Start today's puzzle"}
              </Link>
            </>
          ) : (
            <div className="placeholder-glow" aria-hidden="true">
              <span className="placeholder col-4 mb-3" />
              <br />
              <span className="placeholder col-7" />
            </div>
          )}
        </section>

        <section className="mb-4">
          <div className="d-flex align-items-baseline justify-content-between">
            <h2 className="h5">Today's top 10</h2>
            <Link to="/leaderboard" className="small">
              All leaderboards
            </Link>
          </div>
          {board ? <LeaderboardTable entries={board.entries} compact /> : <p className="text-body-secondary">Loading...</p>}
        </section>

        {recent.length > 0 && (
          <section>
            <h2 className="h5">Your recent puzzles</h2>
            <div className="list-group list-group-flush">
              {recent.map((r) => (
                <Link key={r.id} to={`/p/${r.id}`} className="list-group-item list-group-item-action px-0 d-flex justify-content-between">
                  <span>
                    {r.size}x{r.size} · {r.label}
                  </span>
                  <span className="text-body-secondary small">{new Date(r.created).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="col-lg-5">
        <section className="qbx-settings">
          <h2 className="h5 mb-3">New puzzle</h2>

          <div className="mb-3">
            <div className="form-label">Size</div>
            <div className="btn-group w-100" role="group" aria-label="Grid size">
              {SIZES.map((s) => (
                <button
                  key={s.size}
                  type="button"
                  className={`btn ${settings.size === s.size ? "btn-primary" : "btn-outline-primary"}`}
                  onClick={() => setSettings((st) => ({ ...st, size: s.size }))}
                >
                  {s.label}
                  <span className="d-block small opacity-75">
                    {s.size}x{s.size}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <div className="form-label">Difficulty</div>
            <div className="d-flex flex-wrap gap-1 mb-2">
              {DIFFICULTY_PRESETS.map((p) => {
                const on = p.difficulties.length === settings.difficulties.length && p.difficulties.every((d) => settings.difficulties.includes(d));
                return (
                  <button
                    key={p.label}
                    type="button"
                    className={`btn btn-sm ${on ? "btn-primary" : "btn-outline-primary"}`}
                    onClick={() => setSettings((s) => ({ ...s, difficulties: p.difficulties }))}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <Dropdown keepOpen block className="btn btn-outline-secondary w-100 text-start d-flex justify-content-between align-items-center" label={difficultySummary(settings.difficulties)}>
              <div className="px-2 qbx-checklist">
                {DIFFICULTIES.map(([d, label]) => (
                  <div className="form-check" key={d}>
                    <input className="form-check-input" type="checkbox" id={`diff-${d}`} checked={settings.difficulties.includes(d)} onChange={() => toggleDifficulty(d)} />
                    <label className="form-check-label" htmlFor={`diff-${d}`}>
                      {d}: {label}
                    </label>
                  </div>
                ))}
              </div>
            </Dropdown>
          </div>

          <div className="mb-3">
            <div className="form-label">Subjects</div>
            <button type="button" className="btn btn-outline-secondary w-100 text-start d-flex justify-content-between align-items-center" onClick={() => setPicking(true)}>
              <span className="text-truncate">{describeSubjects(settings.subjects)}</span>
              <i className="bi bi-sliders" />
            </button>
          </div>

          {error && (
            <div className="alert alert-warning small-alert" role="alert">
              {error}
            </div>
          )}
          <button type="button" className="btn btn-primary w-100" onClick={generate} disabled={busy || settings.subjects.subcategories.length === 0}>
            {busy ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                Building grid
              </>
            ) : (
              "Generate puzzle"
            )}
          </button>
          {meta && <p className="small text-body-secondary mt-2 mb-0">{meta.clueCount.toLocaleString()} tossups available.</p>}
        </section>
      </div>

      {picking && (
        <SubjectPicker
          value={settings.subjects}
          counts={meta?.counts ?? null}
          onChange={(subjects) => setSettings((s) => ({ ...s, subjects }))}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
