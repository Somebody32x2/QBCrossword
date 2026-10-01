# QB Crossword

American-style crosswords clued with quizbowl questions. Every entry is the required part of a tossup or bonus
answerline, and its clue is one sentence from a question about that answer. A sentence is only used when the same clue
recurs in at least three distinct questions on that answer, so clues are well-known facts rather than one-off trivia.

- Grids are fully crossed with black squares (rotationally symmetric, every entry at least three letters) and come in
  six sizes from 5x5 to 15x15. You can pick any mix of QB Reader's 0 to 10 difficulty levels and any set of categories,
  subcategories and alternate subcategories.
- A clue's difficulty is its question's level, shifted by up to three levels by the sentence's position: opening lines
  count as harder, giveaways as easier. This widens the pool of usable answers.
- If no full fill is found, the difficulty range is widened by one, then two levels, then to any level, and the
  puzzle is labelled. As a last resort, subjects too narrow to fill are packed into a looser grid.
- The daily puzzle is the same for everyone. It resets at midnight US Eastern and gets harder through the week, from Easy
  High School on Monday to Regionals College on Saturday. Its difficulty is shown on the page.
- The daily has a public top-10 leaderboard. Its timer runs on the server from the moment the clues are first
  delivered. Any check or reveal makes a solve unranked. Top-10 solvers enter three ASCII letters as initials, and the
  server validates them (`^[A-Za-z]{3}$`).
- The timer can be hidden. Custom puzzles can also be paused.

Questions come from the public [QB Reader database backups](https://www.qbreader.org/db/backups).

## Stack

Bun, `bun:sqlite`, React 19, Vite, and Bootstrap 5.3 with the system font stack, styled after QB Reader.

```
client/   React app (Vite root)
server/   Bun HTTP server, grid fill (worker threads), SQLite stores
shared/   Types, taxonomy, answerline parsing, clue text processing
scripts/  ingest.ts: backup export -> hints.db
```

## Data

1. Download the latest backup from <https://www.qbreader.org/db/backups> and extract `tossups.json` and `bonuses.json`
   (MongoDB extended-JSON exports, one document per line) into one directory.
2. Build the hint database:

   ```sh
   bun install
   bun run ingest path/to/backup-dir        # writes data/hints.db
   ```

`hints.db` is read-only at runtime. Mutable state (stored puzzles, daily sessions, scores) lives in `app.db` next to
it. Neither file is versioned.

## Development

```sh
bun run build            # client -> dist/
bun run dev              # API + dist on http://127.0.0.1:3000
bun run dev:client       # optional: Vite dev server with /api proxied to :3000
bun run typecheck
bun test                 # answerline parsing, clue text, grid invariants
```

## Configuration

| Variable      | Default          | Meaning                                                                 |
| ------------- | ---------------- | ----------------------------------------------------------------------- |
| `BASE_PATH`   | empty            | Mount point, e.g. `/qbcrossword`. A build arg too: asset URLs embed it. |
| `DATA_DIR`    | `data`           | Holds `hints.db`, `app.db` and the IP-hash salt.                        |
| `HINTS_DB`    | `$DATA_DIR/hints.db` | Override the hint database path.                                    |
| `PORT`/`HOST` | `3000`/`127.0.0.1` | Listen address (`0.0.0.0` in the Docker image).                       |
| `TRUST_PROXY` | `0` (`1` in Docker) | Number of reverse proxies in front; the client IP is read that many hops from the right of `X-Forwarded-For`. |
| `CLIENT_IP_HEADER` + `CLIENT_IP_HEADER_FROM` | empty | Behind a CDN, e.g. `cf-connecting-ip` + `cloudflare`. The header is trusted only from those edge ranges. |

The server works whether or not the reverse proxy strips `BASE_PATH`.

## Docker

```sh
docker build --build-arg BASE_PATH=/qbcrossword -t qbcrossword .
docker run -p 3000:3000 -v qbcrossword-data:/data qbcrossword
```

Put `hints.db` in the `/data` volume, either by copying one in or by running
`bun scripts/ingest.ts /data/backup /data/hints.db` inside the container.

## License

Code: MIT. Questions belong to their original authors and are distributed by QB Reader.
