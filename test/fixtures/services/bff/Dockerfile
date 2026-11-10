# syntax=docker/dockerfile:1
# Образ verdeect-bff: один образ — экземпляры app. и admin. различаются только окружением (D1).
# Стадии: base → deps → ci → build → development → prod-deps → production.

# Node 24 LTS (D15); patch-версию обновлять вместе с базовым Alpine (как в verdeect-identity).
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
COPY apps/bff/package.json apps/bff/
COPY packages/identity-client/package.json packages/identity-client/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline

# --- ci: зависимости + исходники + git для проверок конвейера (lint, typecheck, unit) ---
FROM deps AS ci
RUN apk add --no-cache git
COPY . .

# --- build: библиотека и BFF → */dist ---
FROM deps AS build
COPY . .
RUN pnpm build

# --- development: исходники монтируются из хоста (compose.override.yml) ---
FROM deps AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000 9100 9229
WORKDIR /app/apps/bff
# Первая сборка всего workspace (библиотека раньше bff), затем tsc --watch и перезапуск node при
# изменении dist. Изменения библиотеки — перезапуск контейнера; tsc --watch следит только за apps/bff.
CMD ["sh", "-c", "pnpm --dir /app build && (pnpm exec tsc -p tsconfig.build.json --watch --preserveWatchOutput & exec node --watch --inspect=0.0.0.0:9229 --enable-source-maps dist/main.js)"]

# --- prod-deps: только production-зависимости apps/bff ---
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/bff/package.json apps/bff/
COPY packages/identity-client/package.json packages/identity-client/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch --prod \
    && pnpm install --frozen-lockfile --offline --prod --filter "bff..." --ignore-scripts

# --- production: без pnpm и исходников; файлы принадлежат root, процесс — пользователь node ---
FROM ${NODE_IMAGE} AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/bff/node_modules ./apps/bff/node_modules
COPY apps/bff/package.json apps/bff/
COPY --from=build /app/apps/bff/dist apps/bff/dist
# Схема событий Identity читается в рантайме (prd.md §9).
COPY apps/bff/contracts apps/bff/contracts
# @verdeect/identity-client (workspace:*): симлинк apps/bff/node_modules указывает сюда, Node берёт dist.
COPY --from=prod-deps /app/packages/identity-client/node_modules ./packages/identity-client/node_modules
COPY packages/identity-client/package.json packages/identity-client/
COPY --from=build /app/packages/identity-client/dist packages/identity-client/dist
WORKDIR /app/apps/bff
USER node
EXPOSE 3000 9100
# В alpine нет curl — проверка через fetch Node; /ok — без обращения к Redis (§13).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.BFF_PORT||3000)+'/ok').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

ARG VERSION=dev
LABEL org.opencontainers.image.title="verdeect-bff" \
      org.opencontainers.image.description="BFF браузерных приложений «Вердикт 2.0»" \
      org.opencontainers.image.version="${VERSION}"
