# Критерии готовности задач 16–17

**Date:** 2026-11-11 18:38
**Plan:** .ai-factory/plans/feature-e8-redis.md
**Severity:** low

## Problem

Задачи 16 и 17 требовали зелёный pnpm pack:check, но ac-9-3-docs.spec.ts красный до задачи 18 (redisWorkerOverride не в README и CHANGELOG)

## Root Cause

Критерий готовности взят на уровне всего набора тестов, а не тестов задачи

## Solution

Задачи 16 и 17 запускают свои спеки test/package; полный pack:check — критерий задачи 18

## Prevention

Критерий готовности задачи — тесты, которые она меняет; полный набор — на чекпоинте фазы после последней задачи

## Tags

#done-criteria
