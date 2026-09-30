# QB Crossword

Crosswords clued with quizbowl tossups. Every entry is the required part of a tossup's answerline, and its clue is the
tossup with the answer blanked out. Clues open on their first sentence or two. Hover over a clue to keep reading (slowly
at first, then faster), click it for another sentence or two, or expand every clue to a set number of sentences.

- Generate puzzles in four sizes (7x7 to 19x19), any mix of QB Reader's 0 to 10 difficulty levels, and any set of
  categories, subcategories and alternate subcategories.
- The daily puzzle is the same for everyone. It resets at midnight US Eastern and gets harder through the week, from Easy
  High School on Monday to Regionals College on Saturday, with a larger Sunday grid. Its difficulty is shown on the page.
- The daily has a public top-10 leaderboard. Its timer runs on the server from the moment the clues are first
  delivered. Any check or reveal makes a solve unranked. Top-10 solvers enter three ASCII letters as initials, and the
  server validates them (`^[A-Za-z]{3}$`).
- The timer can be hidden. Custom puzzles can also be paused.

Questions come from the public [QB Reader database backups](https://www.qbreader.org/db/backups).

## Stack

Bun, `bun:sqlite`, React 19, Vite, and Bootstrap 5.3 with the system font stack, styled after QB Reader.

```
client/   React app (Vite root)
server/   Bun HTTP server, crossword generator, SQLite stores
shared/   Types, taxonomy, answerline parsing, clue text processing
scripts/  ingest.ts: backup export -> clues.db
```

## Data

1. Download the latest backup from <https://www.qbreader.org/db/backups> and extract `tossups.json` (a MongoDB
   extended-JSON export, one document per line).
2. Build the clue database:

   ```sh
   bun install
   bun run ingest path/to/tossups.json        # writes data/clues.db
   ```

`clues.db` is read-only at runtime. Mutable state (stored puzzles, daily sessions, scores) lives in `app.db` next to
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
| `DATA_DIR`    | `data`           | Holds `clues.db`, `app.db` and the IP-hash salt.                        |
| `CLUES_DB`    | `$DATA_DIR/clues.db` | Override the clue database path.                                    |
| `PORT`/`HOST` | `3000`/`127.0.0.1` | Listen address (`0.0.0.0` in the Docker image).                       |
| `TRUST_PROXY` | `0` (`1` in Docker) | Number of reverse proxies in front; the client IP is read that many hops from the right of `X-Forwarded-For`. |
| `CLIENT_IP_HEADER` + `CLIENT_IP_HEADER_FROM` | empty | Behind a CDN, e.g. `cf-connecting-ip` + `cloudflare`. The header is trusted only from those edge ranges. |

The server works whether or not the reverse proxy strips `BASE_PATH`.

## Docker

```sh
docker build --build-arg BASE_PATH=/qbcrossword -t qbcrossword .
docker run -p 3000:3000 -v qbcrossword-data:/data qbcrossword
```

Put `clues.db` in the `/data` volume, either by copying one in or by running
`bun scripts/ingest.ts /data/tossups.json /data/clues.db` inside the container.

## License

Code: MIT. Questions belong to their original authors and are distributed by QB Reader.
