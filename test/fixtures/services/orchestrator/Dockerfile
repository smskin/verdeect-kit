# syntax=docker/dockerfile:1
# Образ verdeect-orchestrator: одна сборка — HTTP (`node dist/main.js`, вместе с ним relay outbox, подписчик
# RabbitMQ и очистка outbox/inbox) и CLI (`node dist/cli.js`: db:prepare, migrate).
# Стадии: base → deps → ci → build → development → prod-deps → production (как verdeect-platform).
# Образ node-agent и образ рантайма DSH — отдельные сборки этапов E3 и E4.

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
# Все пакеты workspace: --frozen-lockfile сверяет lockfile со всеми проектами workspace.
COPY apps/orchestrator/package.json apps/orchestrator/
COPY apps/node-agent/package.json apps/node-agent/
COPY packages/dsh-platform/package.json packages/dsh-platform/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline

# --- ci: зависимости + исходники + git для проверок конвейера (lint, typecheck, unit); make, bash, docker CLI и buildx —
# задание runtime-image (R-тесты образа рантайма с сокетом Docker хоста, план E4 Task 60) ---
FROM deps AS ci
RUN apk add --no-cache git make bash docker-cli docker-cli-buildx
# runtime-image запускает этот образ не от root (--user uid:gid раннера, ревью E4 п. 17, OR-39): pnpm, подготовленный
# corepack в /root (700), переносится в общий каталог — иначе corepack качает его заново из сети.
RUN cp -r /root/.cache/node/corepack /usr/local/share/corepack && chmod -R a+rX /usr/local/share/corepack
ENV COREPACK_HOME=/usr/local/share/corepack
COPY . .

# --- build: apps/orchestrator/dist ---
FROM deps AS build
COPY . .
RUN pnpm --filter orchestrator build

# --- development: исходники монтируются из хоста (compose.override.yml) ---
FROM deps AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000 9100 9229
WORKDIR /app/apps/orchestrator
# Первая сборка, затем tsc --watch и перезапуск node при изменении dist.
CMD ["sh", "-c", "pnpm build && (pnpm exec tsc -p tsconfig.build.json --watch --preserveWatchOutput & exec node --watch --inspect=0.0.0.0:9229 --enable-source-maps dist/main.js)"]

# --- prod-deps: только production-зависимости apps/orchestrator ---
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/orchestrator/package.json apps/orchestrator/
COPY apps/node-agent/package.json apps/node-agent/
COPY packages/dsh-platform/package.json packages/dsh-platform/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch --prod \
    && pnpm install --frozen-lockfile --offline --prod --filter "orchestrator..." --ignore-scripts

# --- production: без pnpm и исходников; файлы принадлежат root, процесс — пользователь node ---
FROM ${NODE_IMAGE} AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/orchestrator/node_modules ./apps/orchestrator/node_modules
COPY apps/orchestrator/package.json apps/orchestrator/
# migrator.ts ищет SQL-миграции в ../../../drizzle от dist/shared/database.
COPY apps/orchestrator/drizzle apps/orchestrator/drizzle
COPY --from=build /app/apps/orchestrator/dist apps/orchestrator/dist
# config/models.yaml в образ не входит: каталог моделей — конфигурация, монтируется томом (G5, prd.md §5.1).
WORKDIR /app/apps/orchestrator
USER node
# 9100 (/health, /metrics) — только внутренняя сеть, Traefik на него не маршрутизирует.
EXPOSE 3000 9100
# В alpine нет curl — проверка через fetch Node; /ok — без БД и брокера.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ok').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

ARG VERSION=dev
LABEL org.opencontainers.image.title="verdeect-orchestrator" \
      org.opencontainers.image.description="Agent Orchestrator «Вердикт 2.0»: диалоги, рабочие места DSH, ретранслятор моделей" \
      org.opencontainers.image.version="${VERSION}"
