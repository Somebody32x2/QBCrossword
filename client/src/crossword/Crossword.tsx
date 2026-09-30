import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AnswerView, ClueView, Direction, Leaderboard, PuzzleView, SessionView, SubmitResult } from "../../../shared/types";
import { DIFFICULTIES } from "../../../shared/taxonomy";
import { api, ApiError } from "../api";
import { Dropdown } from "../components/Dropdown";
import { LeaderboardTable } from "../components/LeaderboardTable";
import { Modal } from "../components/Modal";
import { formatMs, storage } from "../util";
import { ClueText, clueWords, initialWords, useClueReader, wordsForSentences, type ClueWords } from "./ClueText";

interface Clue extends ClueView {
  cells: number[];
  cw: ClueWords;
}

interface Progress {
  letters: string[];
  revealed: boolean[];
  shown: Record<string, number>;
  elapsed: number;
  result: SubmitResult | null;
}

type Scope = "cell" | "word" | "puzzle";

const other = (d: Direction): Direction => (d === "across" ? "down" : "across");

function prepare(puzzle: PuzzleView) {
  const { width } = puzzle;
  const clues: Clue[] = puzzle.clues.map((c) => ({
    ...c,
    cells: Array.from({ length: c.length }, (_, i) => (c.row + (c.dir === "down" ? i : 0)) * width + c.col + (c.dir === "across" ? i : 0)),
    cw: clueWords(c.sentences),
  }));
  const byKey = new Map(clues.map((c) => [c.key, c]));
  const cellClues: Array<Partial<Record<Direction, string>>> = puzzle.cells.map(() => ({}));
  for (const c of clues) for (const i of c.cells) cellClues[i]![c.dir] = c.key;
  return { clues, byKey, cellClues };
}

export function Crossword({
  puzzle,
  session,
  clockOffset = 0,
  header,
}: {
  puzzle: PuzzleView;
  /** Server-timed daily session; custom puzzles are timed locally. */
  session?: SessionView;
  /** serverNow - clientNow when the session was fetched. */
  clockOffset?: number;
  header: ReactNode;
}) {
  const { clues, byKey, cellClues } = useMemo(() => prepare(puzzle), [puzzle]);
  const n = puzzle.width * puzzle.height;
  const progressKey = `progress:${puzzle.id}`;

  const saved = useMemo(() => storage.get<Progress | null>(progressKey, null), [progressKey]);
  const [letters, setLetters] = useState<string[]>(() => (saved?.letters.length === n ? saved.letters : Array(n).fill("")));
  const [revealed, setRevealed] = useState<boolean[]>(() => (saved?.revealed.length === n ? saved.revealed : Array(n).fill(false)));
  const [wrong, setWrong] = useState<boolean[]>(() => Array(n).fill(false));
  const [shown, setShown] = useState<Record<string, number>>(() => saved?.shown ?? {});
  const [result, setResult] = useState<SubmitResult | null>(saved?.result ?? null);
  const [assisted, setAssisted] = useState(session?.assisted ?? false);
  const [sel, setSel] = useState<{ cell: number; dir: Direction }>(() => {
    const first = clues[0];
    return { cell: first?.cells[0] ?? 0, dir: first?.dir ?? "across" };
  });
  const [toast, setToast] = useState<{ kind: "info" | "danger" | "success"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<(() => void) | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [sentenceGoal, setSentenceGoal] = useState(3);

  const solved = result?.solved === true;
  const answers: Record<string, AnswerView> | undefined = result?.answers;

  // ---- Timer -------------------------------------------------------------
  const [timerHidden, setTimerHidden] = useState(() => storage.get("timerHidden", false));
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(saved?.elapsed ?? 0);
  const [, forceTick] = useState(0);
  useEffect(() => storage.set("timerHidden", timerHidden), [timerHidden]);
  useEffect(() => {
    if (solved) return;
    const id = window.setInterval(() => {
      if (session) forceTick((t) => t + 1);
      else if (!paused && document.visibilityState === "visible") setElapsed((e) => e + 1000);
    }, 1000);
    return () => window.clearInterval(id);
  }, [session, paused, solved]);
  const shownElapsed = session
    ? (session.finishedAt ?? (result?.ms !== undefined ? session.startedAt + result.ms : Date.now() + clockOffset)) - session.startedAt
    : elapsed;

  // ---- Persistence -------------------------------------------------------
  useEffect(() => {
    storage.set(progressKey, { letters, revealed, shown, elapsed, result } satisfies Progress);
  }, [progressKey, letters, revealed, shown, elapsed, result]);

  // ---- Selection helpers ---------------------------------------------------
  const activeKey = cellClues[sel.cell]?.[sel.dir] ?? cellClues[sel.cell]?.[other(sel.dir)];
  const active = activeKey ? byKey.get(activeKey) : undefined;
  const crossKey = active ? cellClues[sel.cell]?.[other(active.dir)] : undefined;
  const activeCells = useMemo(() => new Set(active?.cells ?? []), [active]);

  const shownFor = useCallback((c: Clue) => shown[c.key] ?? initialWords(c.cw), [shown]);
  const setShownFor = useCallback((key: string, words: number) => setShown((s) => ({ ...s, [key]: words })), []);

  const select = useCallback(
    (cell: number, dir?: Direction) => {
      const avail = cellClues[cell];
      if (!avail || (!avail.across && !avail.down)) return;
      const want = dir ?? sel.dir;
      setSel({ cell, dir: avail[want] ? want : other(want) });
    },
    [cellClues, sel.dir],
  );

  const selectClue = useCallback(
    (c: Clue) => {
      const empty = c.cells.find((i) => !letters[i]);
      setSel({ cell: empty ?? c.cells[0]!, dir: c.dir });
    },
    [letters],
  );

  const stepClue = (delta: number) => {
    if (!active) return;
    const idx = clues.findIndex((c) => c.key === active.key);
    const next = clues[(idx + delta + clues.length) % clues.length]!;
    selectClue(next);
  };

  // ---- Editing -----------------------------------------------------------
  const locked = (i: number) => solved || revealed[i] === true;

  const typeLetter = (ch: string) => {
    if (!active || paused) return;
    const cell = sel.cell;
    if (!locked(cell)) {
      setLetters((l) => l.map((v, i) => (i === cell ? ch : v)));
      setWrong((w) => (w[cell] ? w.map((v, i) => (i === cell ? false : v)) : w));
    }
    const pos = active.cells.indexOf(cell);
    const after = active.cells.slice(pos + 1);
    const nextEmpty = after.find((i) => !letters[i] && i !== cell);
    if (nextEmpty !== undefined) setSel({ cell: nextEmpty, dir: active.dir });
    else if (pos < active.cells.length - 1) setSel({ cell: active.cells[pos + 1]!, dir: active.dir });
    else {
      // End of the word: jump to the next clue that still has blanks.
      const idx = clues.findIndex((c) => c.key === active.key);
      for (let k = 1; k <= clues.length; k++) {
        const c = clues[(idx + k) % clues.length]!;
        const blank = c.cells.find((i) => !letters[i] && i !== cell);
        if (blank !== undefined) {
          setSel({ cell: blank, dir: c.dir });
          break;
        }
      }
    }
  };

  const backspace = () => {
    if (!active || paused) return;
    const cell = sel.cell;
    const clear = (target: number) => {
      if (locked(target)) return;
      setLetters((l) => l.map((v, i) => (i === target ? "" : v)));
      setWrong((w) => w.map((v, i) => (i === target ? false : v)));
    };
    if (letters[cell] && !locked(cell)) return clear(cell);
    const pos = active.cells.indexOf(cell);
    if (pos > 0) {
      const prev = active.cells[pos - 1]!;
      clear(prev);
      setSel({ cell: prev, dir: active.dir });
    }
  };

  const move = (dr: number, dc: number) => {
    const dir: Direction = dr === 0 ? "across" : "down";
    if (dir !== sel.dir && cellClues[sel.cell]?.[dir]) return setSel({ cell: sel.cell, dir });
    let r = Math.floor(sel.cell / puzzle.width) + dr;
    let c = (sel.cell % puzzle.width) + dc;
    while (r >= 0 && c >= 0 && r < puzzle.height && c < puzzle.width) {
      const idx = r * puzzle.width + c;
      if (puzzle.cells[idx] !== null) return select(idx, dir);
      r += dr;
      c += dc;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const handled = () => e.preventDefault();
    if (/^[a-zA-Z]$/.test(k)) return handled(), typeLetter(k.toUpperCase());
    switch (k) {
      case "Backspace":
      case "Delete":
        return handled(), backspace();
      case "ArrowLeft":
        return handled(), move(0, -1);
      case "ArrowRight":
        return handled(), move(0, 1);
      case "ArrowUp":
        return handled(), move(-1, 0);
      case "ArrowDown":
        return handled(), move(1, 0);
      case "Tab":
        return handled(), stepClue(e.shiftKey ? -1 : 1);
      case "Enter":
        return handled(), stepClue(1);
      case " ":
        return handled(), select(sel.cell, other(sel.dir));
    }
  };

  // Mobile keyboards often report key "Unidentified"; read the input instead.
  const onInput = (e: React.InputEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    e.currentTarget.value = "";
    const ch = value.slice(-1);
    if (/^[a-zA-Z]$/.test(ch)) typeLetter(ch.toUpperCase());
  };

  const input = useRef<HTMLInputElement>(null);
  const focusGrid = () => input.current?.focus({ preventScroll: true });

  // ---- Server actions ----------------------------------------------------
  const flash = (kind: "info" | "danger" | "success", text: string) => setToast({ kind, text });
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const scopeCells = (scope: Scope): number[] =>
    scope === "cell" ? [sel.cell] : scope === "word" ? (active?.cells ?? []) : puzzle.cells.flatMap((c, i) => (c === null ? [] : [i]));

  /** Daily solves become unranked on the first check or reveal; confirm before that happens. */
  const guarded = (action: () => void) => {
    if (session && !assisted && !solved) setConfirm(() => action);
    else action();
  };

  const doCheck = (scope: Scope) =>
    guarded(async () => {
      try {
        const cells = scopeCells(scope);
        const res = await api.check(puzzle.id, letters, cells, session?.id);
        if (session) setAssisted(true);
        const bad = new Set(res.wrong);
        setWrong((w) => w.map((v, i) => v || bad.has(i)));
        const filled = cells.filter((i) => letters[i]).length;
        if (filled === 0) flash("info", "Nothing to check yet.");
        else if (bad.size === 0) flash("success", filled === 1 ? "That letter is correct." : "All checked letters are correct.");
        else flash("danger", `${bad.size} incorrect ${bad.size === 1 ? "letter" : "letters"} marked.`);
      } catch (e) {
        flash("danger", e instanceof ApiError ? e.message : "Check failed.");
      }
    });

  const doReveal = (scope: Scope) =>
    guarded(async () => {
      try {
        const res = await api.reveal(puzzle.id, scopeCells(scope), session?.id);
        if (session) setAssisted(true);
        const got = new Map(Object.entries(res.letters).map(([i, l]) => [Number(i), l]));
        setLetters((l) => l.map((v, i) => got.get(i) ?? v));
        setRevealed((r) => r.map((v, i) => v || got.has(i)));
        setWrong((w) => w.map((v, i) => (got.has(i) ? false : v)));
      } catch (e) {
        flash("danger", e instanceof ApiError ? e.message : "Reveal failed.");
      }
    });

  const doClear = (scope: "word" | "puzzle") => {
    if (solved) return;
    const cells = new Set(scopeCells(scope));
    setLetters((l) => l.map((v, i) => (cells.has(i) && !revealed[i] ? "" : v)));
    setWrong((w) => w.map((v, i) => (cells.has(i) ? false : v)));
  };

  // Submit whenever the grid is full; the server decides if it is right.
  const lastSubmitted = useRef("");
  useEffect(() => {
    if (solved) return;
    const full = puzzle.cells.every((c, i) => c === null || letters[i]);
    const joined = letters.join(",");
    if (!full || joined === lastSubmitted.current) return;
    lastSubmitted.current = joined;
    api
      .submit(puzzle.id, letters, session?.id)
      .then((res) => {
        if (res.solved) {
          setResult(res);
          setShowDone(true);
          setPaused(false);
        } else {
          flash("danger", "The grid is full, but something isn't right yet.");
        }
      })
      .catch((e: unknown) => flash("danger", e instanceof ApiError ? e.message : "Could not submit the grid."));
  }, [letters, solved, puzzle, session?.id]);

  const applySentenceGoal = (all: boolean) => {
    setShown((s) => {
      const next = { ...s };
      for (const c of clues) {
        const goal = all ? c.cw.words.length : wordsForSentences(c.cw, sentenceGoal);
        next[c.key] = Math.max(shownFor(c), goal);
      }
      return next;
    });
  };

  // Keep the active clue visible in its list without scrolling the page.
  const listRefs = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => {
    const el = activeKey ? listRefs.current.get(activeKey) : undefined;
    const box = el?.closest(".qbx-clue-scroll");
    if (!el || !(box instanceof HTMLElement)) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
    }
  }, [activeKey]);

  const ranked = session && !assisted;

  // ---- Render ------------------------------------------------------------
  const renderClue = (c: Clue) => (
    <ClueItem
      key={c.key}
      clue={c}
      shown={shownFor(c)}
      onShow={(w) => setShownFor(c.key, w)}
      state={c.key === activeKey ? "active" : c.key === crossKey ? "cross" : undefined}
      complete={!solved && c.cells.every((i) => letters[i])}
      answer={answers?.[c.key]}
      onSelect={() => {
        selectClue(c);
        focusGrid();
      }}
      register={(el) => {
        if (el) listRefs.current.set(c.key, el);
        else listRefs.current.delete(c.key);
      }}
    />
  );

  const across = clues.filter((c) => c.dir === "across");
  const down = clues.filter((c) => c.dir === "down");

  return (
    <div className="qbx-puzzle">
      <div className="qbx-toolbar d-flex flex-wrap align-items-center gap-2 mb-3">
        <div className="me-auto">{header}</div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div className="d-flex align-items-center gap-1">
            <div className={`qbx-timer font-monospace${timerHidden ? " qbx-timer-hidden" : ""}`} aria-live="off">
              {timerHidden ? "--:--" : formatMs(shownElapsed)}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setTimerHidden((h) => !h)}
              title={timerHidden ? "Show timer" : "Hide timer"}
            >
              <i className={`bi ${timerHidden ? "bi-eye" : "bi-eye-slash"}`} />
            </button>
            {!session && !solved && (
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setPaused((p) => !p)} title={paused ? "Resume" : "Pause"}>
                <i className={`bi ${paused ? "bi-play-fill" : "bi-pause-fill"}`} />
              </button>
            )}
          </div>
          <Dropdown label="Check" disabled={solved}>
            <button type="button" className="dropdown-item" onClick={() => doCheck("cell")}>Letter</button>
            <button type="button" className="dropdown-item" onClick={() => doCheck("word")}>Word</button>
            <button type="button" className="dropdown-item" onClick={() => doCheck("puzzle")}>Puzzle</button>
          </Dropdown>
          <Dropdown label="Reveal" disabled={solved}>
            <button type="button" className="dropdown-item" onClick={() => doReveal("cell")}>Letter</button>
            <button type="button" className="dropdown-item" onClick={() => doReveal("word")}>Word</button>
            <button type="button" className="dropdown-item" onClick={() => doReveal("puzzle")}>Puzzle</button>
          </Dropdown>
          <Dropdown label="Clear" disabled={solved} align="end">
            <button type="button" className="dropdown-item" onClick={() => doClear("word")}>Word</button>
            <button type="button" className="dropdown-item" onClick={() => doClear("puzzle")}>Puzzle</button>
          </Dropdown>
        </div>
      </div>

      {session && (
        <div className="small mb-2 text-body-secondary">
          {solved ? (
            <>Solved in {formatMs(shownElapsed)}{assisted ? " with help (unranked)." : "."}</>
          ) : ranked ? (
            <><i className="bi bi-trophy" /> Ranked solve: the clock runs on the server, and checking or revealing makes it unranked.</>
          ) : (
            <><i className="bi bi-info-circle" /> Unranked: you checked or revealed on this puzzle.</>
          )}
        </div>
      )}

      {toast && (
        <div className={`alert alert-${toast.kind} small-alert py-2 mb-2`} role="status">
          {toast.text}
        </div>
      )}

      <div className="row g-4">
        <div className="col-lg-7">
          {active && (
            <ClueBar key={active.key} clue={active} shown={shownFor(active)} onShow={(w) => setShownFor(active.key, w)} onFocus={focusGrid} />
          )}
          <div
            className="qbx-grid-wrap"
            style={{ maxWidth: `min(${puzzle.width * 2.75}rem, max(20rem, calc((100dvh - 18rem) * ${puzzle.width / puzzle.height})))` }}
          >
            <div
              className={`qbx-grid${paused ? " qbx-grid-paused" : ""}`}
              style={{ gridTemplateColumns: `repeat(${puzzle.width}, minmax(0, 1fr))`, ["--cols" as string]: puzzle.width }}
              onPointerDown={(e) => {
                // Keep focus on the hidden input so typing keeps working.
                e.preventDefault();
                focusGrid();
              }}
            >
              {puzzle.cells.map((num, i) => {
                if (num === null) return <div key={i} className="qbx-cell qbx-block" aria-hidden="true" />;
                const cls = [
                  "qbx-cell",
                  i === sel.cell ? "qbx-selected" : activeCells.has(i) ? "qbx-in-word" : "",
                  wrong[i] ? "qbx-wrong" : "",
                  revealed[i] ? "qbx-revealed" : "",
                  solved ? "qbx-solved" : "",
                ].join(" ");
                return (
                  <div
                    key={i}
                    className={cls}
                    onPointerDown={() => (i === sel.cell ? select(i, other(sel.dir)) : select(i))}
                    role="gridcell"
                    aria-label={`${num ? `${num}, ` : ""}${letters[i] || "blank"}`}
                  >
                    {num > 0 && <span className="qbx-num">{num}</span>}
                    <span className="qbx-letter">{paused ? "" : letters[i]}</span>
                  </div>
                );
              })}
              <input
                ref={input}
                className="qbx-input"
                aria-label="Crossword input"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onKeyDown={onKeyDown}
                onInput={onInput}
              />
              {paused && (
                <div className="qbx-paused-overlay">
                  <button type="button" className="btn btn-primary" onClick={() => setPaused(false)}>
                    <i className="bi bi-play-fill" /> Resume
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="d-flex align-items-center gap-2 mb-2 small flex-wrap">
            <label htmlFor="qbx-sentences" className="text-body-secondary">
              Show
            </label>
            <input
              id="qbx-sentences"
              type="number"
              min={1}
              max={12}
              className="form-control form-control-sm"
              style={{ width: "4.25rem" }}
              value={sentenceGoal}
              onChange={(e) => setSentenceGoal(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
            />
            <span className="text-body-secondary">sentences</span>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => applySentenceGoal(false)}>
              Expand
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => applySentenceGoal(true)}>
              Expand all
            </button>
          </div>
          <div className="qbx-clue-scroll">
            <h6 className="qbx-clue-heading">Across</h6>
            <ul className="list-group list-group-flush mb-3">{across.map(renderClue)}</ul>
            <h6 className="qbx-clue-heading">Down</h6>
            <ul className="list-group list-group-flush">{down.map(renderClue)}</ul>
          </div>
        </div>
      </div>

      {confirm && (
        <Modal
          title="Leave the leaderboard?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const action = confirm;
                  setConfirm(null);
                  action();
                }}
              >
                Continue
              </button>
            </>
          }
        >
          Checking or revealing makes today's solve unranked. Your time will still be shown, but it will not go on the leaderboard.
        </Modal>
      )}

      {showDone && result?.solved && (
        <SolvedModal
          puzzle={puzzle}
          result={result}
          elapsed={shownElapsed}
          sessionId={session?.id}
          onClose={() => setShowDone(false)}
          onClaimed={() => setResult((r) => (r ? { ...r, claimed: true, qualifies: false } : r))}
        />
      )}
    </div>
  );
}

function ClueItem({
  clue: c,
  shown,
  onShow,
  state,
  complete,
  answer,
  onSelect,
  register,
}: {
  clue: Clue;
  shown: number;
  onShow: (words: number) => void;
  state?: "active" | "cross";
  complete: boolean;
  answer?: AnswerView;
  onSelect: () => void;
  register: (el: HTMLLIElement | null) => void;
}) {
  const reader = useClueReader(c.cw, shown, onShow);
  return (
    <li
      ref={register}
      className={`qbx-clue list-group-item${state ? ` qbx-clue-${state}` : ""}${complete ? " qbx-clue-complete" : ""}`}
      onMouseEnter={reader.onMouseEnter}
      onMouseLeave={reader.onMouseLeave}
      onClick={() => {
        reader.more();
        onSelect();
      }}
    >
      <span className="qbx-clue-num">{c.number}</span>
      <div className="qbx-clue-body">
        <ClueText cw={c.cw} shown={shown} /> <span className="text-body-secondary small text-nowrap">({c.enumeration})</span>
        {answer && (
          <div className="qbx-answer small mt-1">
            <b>ANSWER:</b> {answer.answer}{" "}
            <a href={`https://www.qbreader.org/db/tossup/?_id=${c.qbreaderId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              <i className="bi bi-box-arrow-up-right" aria-label="View on QB Reader" />
            </a>
          </div>
        )}
        <div className="qbx-clue-meta small text-body-secondary">
          {c.category}
          {c.subcategory !== c.category ? ` / ${c.subcategory}` : ""}
          {c.alternateSubcategory ? ` / ${c.alternateSubcategory}` : ""}
          {" · "}
          {c.setName}
        </div>
      </div>
    </li>
  );
}

function ClueBar({ clue, shown, onShow, onFocus }: { clue: Clue; shown: number; onShow: (words: number) => void; onFocus: () => void }) {
  const reader = useClueReader(clue.cw, shown, onShow);
  return (
    <div
      className="qbx-clue-bar mb-2"
      onMouseEnter={reader.onMouseEnter}
      onMouseLeave={reader.onMouseLeave}
      onClick={() => {
        reader.more();
        onFocus();
      }}
      title="Hover to keep reading, click for more"
    >
      <div className="qbx-clue-bar-label">
        {clue.number} {clue.dir === "across" ? "Across" : "Down"}
        <span className="text-body-secondary fw-normal ms-2 small">
          {clue.category} · {DIFFICULTIES.find(([d]) => d === clue.difficulty)?.[1]}
        </span>
      </div>
      <div className="qbx-clue-bar-text">
        <ClueText cw={clue.cw} shown={shown} /> <span className="text-body-secondary text-nowrap">({clue.enumeration})</span>
      </div>
    </div>
  );
}

function SolvedModal({
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
      {!daily && <p className="mb-0 text-body-secondary">Answers and links to each tossup on QB Reader are now shown with the clues.</p>}
    </Modal>
  );
}
