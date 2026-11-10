# E2 +check цикл 2, итерация 1: точный DSN_REGEX и отсчёт времени от маркера сигнала

**Date:** 2026-11-10 14:23
**Plan:** .ai-factory/plans/feature-e2-observability.md
**Severity:** medium

## Problem

Проверка DSN мягче DSN_REGEX SDK; тест настоящего SDK через vi.importActual не работает при моке; время выхода ребёнка мерилось без точки отсчёта

## Root Cause

Правка итерации 4 описала проверку по URL, а не по выражению SDK; стенд ребёнка не учёл время загрузки

## Solution

DSN_REGEX SDK в initSentry, отдельный файл ac-2-4-init-sentry-sdk.spec.ts, маркер {"signal":true} перед SIGTERM

## Prevention

Повторять валидацию внешней библиотеки её собственным правилом; мерить время от события, а не от запуска процесса

## Tags

#iteration #check #sentry #timing
