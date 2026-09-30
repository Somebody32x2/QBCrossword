import { DAILY_SCHEDULE, DIFFICULTIES } from "../../../shared/taxonomy";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function About() {
  // Monday first, Sunday last.
  const week = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div style={{ maxWidth: "65ch" }}>
      <h1 className="h3">About</h1>
      <p>
        QB Crossword builds crosswords whose clues are quizbowl tossups. Each answer in the grid is the required part of a
        tossup's answerline, and the clue is the tossup itself with the answer blanked out.
      </p>
      <h2 className="h5 mt-4">Reading clues</h2>
      <ul>
        <li>Each clue starts with its first sentence or two, the hardest part of the tossup.</li>
        <li>Hover over a clue to keep reading. It starts slowly and speeds up.</li>
        <li>Click a clue to reveal another sentence or two, or use the sentence control above the clue list.</li>
        <li>The number in parentheses gives the length of each word in the answer.</li>
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
        . The questions were written by their original tournament authors. Every solved clue links to its tossup on QB
        Reader.
      </p>
    </div>
  );
}
