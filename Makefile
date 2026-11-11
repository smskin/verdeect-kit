# @verdeect/kit — единая точка входа: make help
#
# Все цели работают на хосте: это npm-библиотека без своих Docker-файлов и стека разработки.
# Уровни тестов (prd.md §5, docs/testing.md):
#   test / test-module — уровень U (test/unit), без сети и Docker; во время работы.
#   test-integration   — уровень I (test/integration): Testcontainers на TEST_IMAGES, один раз на прогон
#                        в globalSetup через startTestStack; нужен Docker; входит в ci.
#   test-timing        — уровень T (test/timing), реальные ожидания; только на тихой машине.
#   test-load          — нагрузочного набора нет, уровень пуст.
#   test-full          — перед слиянием и выпуском: lint, analyse, test, test-integration, test-timing, pack-check.
# pack-check — уровни R и C: сборка dist/, архив, проекты-потребители test/consumer на упакованном архиве.
# TEST_TIMEOUT_SCALE — множитель тайм-аутов конфигов Vitest, только локально на загруженной машине (в CI — 1).
# Цели публикации нет — пакет публикует только CI (scripts/publish.mjs, docs/releasing.md).
# Многострочные рецепты склеены через `; \` — make 3.81 (macOS) игнорирует .ONESHELL.

SHELL := bash
.ONESHELL:
.SHELLFLAGS := -eu -o pipefail -c
.DELETE_ON_ERROR:
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules

# --- Инструменты (переопределяемые) ---
PNPM ?= pnpm

# --- Параметры целей ---
# test, test-module: фильтр по имени теста (vitest -t), например FILTER='AC-1.8'.
FILTER ?=
# test-module: подпути через пробел (config testing) → test/unit/<m> и test/integration/<m>.
M ?=
# Множитель testTimeout и hookTimeout конфигов Vitest (число > 0); задаётся вручную, не по нагрузке.
TEST_TIMEOUT_SCALE ?= 1
export TEST_TIMEOUT_SCALE

.DEFAULT_GOAL := help

##@ Справка

.PHONY: help
help: ## Список целей
	@awk 'BEGIN {FS = ":.*##"; printf "Использование: make \033[36m<цель>\033[0m\n"} \
		/^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

##@ Установка

.PHONY: install
install: ## Зависимости по pnpm-lock.yaml
	$(PNPM) install --frozen-lockfile

##@ Проверки

.PHONY: lint
lint: ## ESLint, проверка Prettier и правила lint на фикстурах (AC-9.4)
	$(PNPM) lint; \
	$(PNPM) format:check; \
	$(PNPM) exec vitest run -c vitest.package.config.ts test/package/ac-9-4-lint-rules.spec.ts

# Политика зависимостей (peer по NFR-3, testing не в dependencies) проверяется тестом манифеста уровня U.
.PHONY: analyse
analyse: ## tsc --noEmit и политика зависимостей манифеста (NFR-3)
	$(PNPM) typecheck; \
	$(PNPM) exec vitest run test/unit/package

.PHONY: build
build: ## Сборка в dist/ (.js + .d.ts, CLI verdeect-kit)
	$(PNPM) build

.PHONY: pack-check
pack-check: ## Сборка dist/, архив, publint, attw esm-only, проекты-потребители test/consumer (R, C)
	$(PNPM) pack:check

.PHONY: test-package
test-package: build ## Только проверки архива и проектов-потребителей (без пересборки в pack:check)
	$(PNPM) test:package

.PHONY: ci
ci: lint analyse test test-integration build pack-check ## Всё в порядке конвейера (уровень I — на публичных образах)

##@ Уровни тестов

.PHONY: test
test: ## Уровень U (test/unit); по имени: make test FILTER='AC-1.8'
	$(PNPM) exec vitest run $(if $(FILTER),-t "$(FILTER)")

.PHONY: test-module
test-module: ## U + I подпутей: make test-module M='config testing' (без M — только U)
	$(PNPM) exec vitest run $(foreach m,$(M),test/unit/$(m)) $(if $(FILTER),-t "$(FILTER)"); \
	if [ -n "$(strip $(M))" ]; then \
		dirs=""; \
		for m in $(M); do if [ -d "test/integration/$$m" ]; then dirs="$$dirs test/integration/$$m"; fi; done; \
		if [ -n "$$dirs" ]; then \
			$(PNPM) exec vitest run -c vitest.integration.config.ts $$dirs $(if $(FILTER),-t "$(FILTER)"); \
		fi; \
	fi

.PHONY: test-integration
test-integration: ## Уровень I (test/integration) — Testcontainers, нужен Docker; покрытие outbox (AC-5.13)
	KIT_OUTBOX_COVERAGE=1 $(PNPM) test:integration

# Нагрузку хоста только сообщает; отказ при поднятом контуре e2e делает timingGuard (globalSetup).
.PHONY: test-timing
test-timing: ## Уровень T (test/timing) — только на тихой машине
	@cores=$$(getconf _NPROCESSORS_ONLN); \
	if [ -r /proc/loadavg ]; then \
		load=$$(cut -d' ' -f1 /proc/loadavg); \
	else \
		load=$$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | awk '{ print $$1 }' || true); \
	fi; \
	echo "[test-timing] load average: $${load:-неизвестно} (ядер: $$cores)"; \
	if [ -n "$${load:-}" ] && awk -v l="$$load" -v c="$$cores" 'BEGIN { exit !(l > c) }'; then \
		echo "[test-timing] WARN: машина загружена — замеры недостоверны, повторите на тихой машине"; \
	fi; \
	$(PNPM) test:timing

.PHONY: test-load
test-load: ## Нагрузочного набора нет — сообщение и код 0
	@echo "[test-load] нагрузочного набора нет — уровень пуст"

.PHONY: test-full
test-full: lint analyse test test-integration test-timing pack-check ## Перед слиянием и выпуском (нужен Docker)

##@ Очистка

.PHONY: clean
clean: ## Сборка, покрытие и архивы
	rm -rf dist coverage *.tgz
