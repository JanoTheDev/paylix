# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/config/package.json ./packages/config/
# apps/web declares @paylix/mailer as a workspace dependency; without its
# manifest `pnpm install --frozen-lockfile` cannot resolve `workspace:*`.
COPY packages/mailer/package.json ./packages/mailer/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=deps /app/packages/mailer/node_modules ./packages/mailer/node_modules
# Copy sources explicitly instead of `COPY . .` so the context is opt-in:
# nothing outside these paths (.env, .git, audit/, build caches) can reach a layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web ./apps/web
COPY packages/db ./packages/db
COPY packages/config ./packages/config
COPY packages/mailer ./packages/mailer
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` inlines NEXT_PUBLIC_* into the client bundle and evaluates route
# modules that read server env, so it needs .env at build time. It is mounted as
# a BuildKit secret (tmpfs, never written to any layer) rather than COPYed in —
# see .dockerignore. docker-compose.yml wires the secret up; a plain
# `docker build` without it still runs (required=false) but produces a bundle
# with no chain configured.
RUN --mount=type=secret,id=dotenv,target=/app/.env,required=false \
    pnpm --filter @paylix/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
