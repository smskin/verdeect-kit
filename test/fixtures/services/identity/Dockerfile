# syntax=docker/dockerfile:1
# Образ verdeect-identity: одна сборка — HTTP (`node dist/main.js`) и CLI (`node dist/cli.js`,
# сервис identity-migrate). Стадии: base → deps → ci → build → development → prod-deps → production.

# Node 24 LTS (DESCRIPTION.md); patch-версию обновлять вместе с базовым Alpine.
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
COPY apps/identity/package.json apps/identity/
COPY apps/identity-pages/package.json apps/identity-pages/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline

# --- ci: зависимости + исходники + git для проверок конвейера (lint, typecheck, unit) ---
FROM deps AS ci
RUN apk add --no-cache git
COPY . .

# --- build: страницы → apps/identity/public, backend → apps/identity/dist ---
FROM deps AS build
# Релиз страниц вшивается при сборке (__APP_RELEASE__, GT05); не секрет.
ARG SENTRY_RELEASE=dev
# GT13: скрытые source maps страниц загружаются в GlitchTip при секрете sentry_auth_token (CI, стадия Build)
# и в образ не попадают; без секрета загрузка выключена, карты просто удаляются.
ARG SENTRY_ORG=
ARG SENTRY_PROJECT_FRONTEND=identity-frontend
COPY . .
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    SENTRY_RELEASE=${SENTRY_RELEASE} SENTRY_ORG="${SENTRY_ORG}" \
    SENTRY_PROJECT_FRONTEND="${SENTRY_PROJECT_FRONTEND}" pnpm build \
    && find apps/identity/public -name '*.map' -delete

# --- development: исходники монтируются из хоста (compose.override.yml) ---
FROM deps AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000 5173 9229
WORKDIR /app/apps/identity
# Первая сборка, затем tsc --watch и перезапуск node при изменении dist.
CMD ["sh", "-c", "pnpm build && (pnpm exec tsc -p tsconfig.build.json --watch --preserveWatchOutput & exec node --watch --inspect=0.0.0.0:9229 --enable-source-maps dist/main.js)"]

# --- prod-deps: только production-зависимости apps/identity ---
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/identity/package.json apps/identity/
COPY apps/identity-pages/package.json apps/identity-pages/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch --prod \
    && pnpm install --frozen-lockfile --offline --prod --filter "identity..." --ignore-scripts

# --- production: без pnpm и исходников; файлы принадлежат root, процесс — пользователь node ---
FROM ${NODE_IMAGE} AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/identity/node_modules ./apps/identity/node_modules
COPY apps/identity/package.json apps/identity/
# migrator.ts ищет SQL-миграции в ../../../drizzle от dist/shared/database.
COPY apps/identity/drizzle apps/identity/drizzle
COPY --from=build /app/apps/identity/dist apps/identity/dist
COPY --from=build /app/apps/identity/public apps/identity/public
WORKDIR /app/apps/identity
USER node
EXPOSE 3000
# В alpine нет curl — проверка через fetch Node; /ok — без БД (AC-9.1).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.IDENTITY_PORT||3000)+'/ok').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

ARG VERSION=dev
LABEL org.opencontainers.image.title="verdeect-identity" \
      org.opencontainers.image.description="Сервер авторизации OAuth 2.0 / OpenID Connect «Вердикт 2.0»" \
      org.opencontainers.image.version="${VERSION}"
