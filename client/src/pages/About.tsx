import { DAILY_SCHEDULE, DIFFICULTIES } from "../../../shared/taxonomy";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function About() {
  // Monday first, Sunday last.
  const week = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div style={{ maxWidth: "65ch" }}>
      <h1 className="h3">About</h1>
      <p>
        QB Crossword builds American-style crosswords whose clues come from quizbowl questions. Each answer is the required
        part of a tossup or bonus answerline, and its clue is a single sentence from a question about that answer.
      </p>
      <h2 className="h5 mt-4">How clues are chosen</h2>
      <ul>
        <li>
          A sentence is only used if the same clue appears in at least three different questions on that answer, so clues
          are the well-known facts writers keep returning to, not one-off trivia.
        </li>
        <li>
          A clue's difficulty is its question's level, shifted by up to three levels by where the sentence sits: opening
          lines count as harder, giveaways as easier.
        </li>
        <li>
          Grids are fully crossed, with black squares, whenever a fill can be found. If not, the difficulty range is widened
          by up to two levels on each side, and the puzzle says so. Very narrow subject choices fall back to a looser grid.
        </li>
      </ul>
      <h2 className="h5 mt-4">Controls</h2>
      <p>
        Type to fill squares. Arrow keys move, Space switches direction, Tab and Shift+Tab move between clues, and Backspace
        deletes. Click a selected square again to switch direction.
      </p>
      <h2 className="h5 mt-4">Daily schedule</h2>
      <p>The daily puzzle resets at midnight US Eastern time and gets harder through the week:</p>
      <table className="table table-sm" style={{ maxWidth: "32rem" }}>
        <tbody>
          {week.map((d) => {
            const rule = DAILY_SCHEDULE[d]!;
            return (
              <tr key={d}>
                <td>{WEEKDAYS[d]}</td>
                <td>{rule.label}</td>
                <td className="text-end text-body-secondary">
                  {rule.size}x{rule.size}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        Only clean solves, with no checks or reveals, are ranked. The clock runs on the server from the moment you start. The
        top 10 solvers each day can put up three-letter initials.
      </p>
      <h2 className="h5 mt-4">Difficulty levels</h2>
      <p>Difficulty follows QB Reader's 0 to 10 scale:</p>
      <ul className="small">
        {DIFFICULTIES.map(([d, label]) => (
          <li key={d}>
            {d}: {label}
          </li>
        ))}
      </ul>
      <h2 className="h5 mt-4">Questions</h2>
      <p>
        Questions come from the public database backups of{" "}
        <a href="https://www.qbreader.org" target="_blank" rel="noreferrer">
          QB Reader
        </a>
        . The questions were written by their original tournament authors. Every solved clue links to its question on QB
        Reader.
      </p>
    </div>
  );
}
