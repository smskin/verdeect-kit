# syntax=docker/dockerfile:1
# Образ verdeect-platform: одна сборка — HTTP (`node dist/main.js`, вместе с ним relay outbox, подписчик
# и очистка) и CLI (`node dist/cli.js`: platform-migrate, db:prepare, plan:apply и команды оператора).
# Стадии: base → deps → ci → build → development → prod-deps → production (как verdeect-identity).

# Node 24 LTS (.nvmrc); patch-версию обновлять вместе с базовым Alpine.
ARG NODE_IMAGE=node:24.22-alpine3.24

# --- base: runtime + pnpm через corepack ---
FROM ${NODE_IMAGE} AS base
# Версия = packageManager в корневом package.json; prepare здесь, чтобы стадии не качали pnpm заново.
ARG PNPM_VERSION=12.11.2
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm --version скачивает нативный бинарник pnpm 12 в этот слой, а не в каждую стадию.
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate && pnpm --version
WORKDIR /app

# --- deps: все зависимости workspace (кэш стора pnpm между сборками) ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch
COPY package.json ./
COPY apps/platform/package.json apps/platform/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline

# --- ci: зависимости + исходники + git для проверок конвейера (lint, typecheck, unit) ---
FROM deps AS ci
RUN apk add --no-cache git
COPY . .

# --- build: apps/platform/dist ---
FROM deps AS build
COPY . .
RUN pnpm build

# --- development: исходники монтируются из хоста (compose.override.yml) ---
FROM deps AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000 9100 9229
WORKDIR /app/apps/platform
# Первая сборка, затем tsc --watch и перезапуск node при изменении dist.
CMD ["sh", "-c", "pnpm build && (pnpm exec tsc -p tsconfig.build.json --watch --preserveWatchOutput & exec node --watch --inspect=0.0.0.0:9229 --enable-source-maps dist/main.js)"]

# --- prod-deps: только production-зависимости apps/platform ---
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/platform/package.json apps/platform/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch --prod \
    && pnpm install --frozen-lockfile --offline --prod --filter "platform..." --ignore-scripts

# --- production: без pnpm и исходников; файлы принадлежат root, процесс — пользователь node ---
FROM ${NODE_IMAGE} AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/platform/node_modules ./apps/platform/node_modules
COPY apps/platform/package.json apps/platform/
# migrator.ts ищет SQL-миграции в ../../../drizzle от dist/shared/database.
COPY apps/platform/drizzle apps/platform/drizzle
# Тарифы для plan:apply --file seed/plans.json (prd.md §10, §16); WORKDIR — apps/platform.
COPY seed apps/platform/seed
COPY --from=build /app/apps/platform/dist apps/platform/dist
WORKDIR /app/apps/platform
USER node
# 9100 (/health, /metrics) — только внутренняя сеть, Traefik на него не маршрутизирует.
EXPOSE 3000 9100
# В alpine нет curl — проверка через fetch Node; /ok — без БД и брокера.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ok').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

ARG VERSION=dev
LABEL org.opencontainers.image.title="verdeect-platform" \
      org.opencontainers.image.description="Сервис прав «Вердикт 2.0»: authz, bootstrap, компании и участники" \
      org.opencontainers.image.version="${VERSION}"
