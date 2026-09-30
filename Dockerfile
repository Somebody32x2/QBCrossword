# syntax=docker/dockerfile:1

# The client bundle has the mount point baked into its asset URLs, so BASE_PATH
# is a build argument. It must match the server's BASE_PATH at runtime.
ARG BASE_PATH=""

# --- build ------------------------------------------------------------------
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY shared ./shared
COPY client ./client
ARG BASE_PATH
ENV BASE_PATH=${BASE_PATH}
RUN bun run build

# --- runtime ----------------------------------------------------------------
FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY --from=build /app/dist ./dist

# /data holds clues.db (built with `bun run ingest`) and app.db (puzzles,
# sessions, scores). Mount a volume here or scores vanish on redeploy.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R bun:bun /data /app

ARG BASE_PATH
ENV BASE_PATH=${BASE_PATH}
# Reverse proxies in front of the container; the client IP is read this many
# hops from the right of X-Forwarded-For.
ENV TRUST_PROXY=1
ENV PORT=3000
ENV HOST=0.0.0.0

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+(process.env.BASE_PATH||'')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "server/index.ts"]
