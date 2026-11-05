# Production image. Multi-stage so the runtime carries only compiled JS and
# production dependencies — no TypeScript, no ESLint, no source.
#
#   docker build -t mzazicare-api .
#   docker run --env-file .env -p 4000:4000 mzazicare-api

# ── base ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# ── dependencies (all, including dev — needed to compile) ────────────────────
FROM base AS deps

# Copied on their own so a source change does not bust the install cache.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build

COPY tsconfig.json ./
COPY src ./src

# tsc emits to dist/, then tsc-alias rewrites the @/ paths to relative ones.
RUN pnpm run build

# ── production dependencies only ─────────────────────────────────────────────
FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Run as the unprivileged user the node image already ships.
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4000}${API_PREFIX:-/v1}/health" || exit 1

# server.ts installs SIGTERM/SIGINT handlers, so node can be PID 1.
# Compose sets `init: true` to reap zombies.
CMD ["node", "dist/server.js"]
