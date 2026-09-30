import type { LeaderboardEntry } from "../../../shared/types";
import { formatMs } from "../util";

export function LeaderboardTable({
  entries,
  highlightMs,
  compact = false,
}: {
  entries: LeaderboardEntry[];
  /** Highlights the row with this time (the player's own entry). */
  highlightMs?: number;
  compact?: boolean;
}) {
  if (entries.length === 0) {
    return <p className="text-body-secondary mb-0">No clean solves yet. Finish without checking or revealing to claim the top spot.</p>;
  }
  return (
    <table className={`table table-hover mb-0${compact ? " table-sm" : ""}`}>
      <thead>
        <tr>
          <th scope="col" style={{ width: "3.5rem" }}>
            #
          </th>
          <th scope="col">Initials</th>
          <th scope="col" className="text-end">
            Time
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={`${e.rank}-${e.initials}`} className={e.ms === highlightMs ? "qbx-own-row" : undefined}>
            <td>{e.rank}</td>
            <td className="qbx-initials">{e.initials}</td>
            <td className="text-end font-monospace">{formatMs(e.ms)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
