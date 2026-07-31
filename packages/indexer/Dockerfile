FROM node:20-alpine AS base
RUN corepack enable pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/db/package.json ./packages/db/
COPY packages/config/package.json ./packages/config/
# @paylix/indexer declares @paylix/mailer as a workspace dependency; without its
# manifest `pnpm install --frozen-lockfile` cannot resolve `workspace:*`.
COPY packages/mailer/package.json ./packages/mailer/
RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/
CMD ["pnpm", "--filter", "@paylix/indexer", "start"]
