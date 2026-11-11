# REDIS_URL в существующих запусках потребителя

**Date:** 2026-11-11 18:22
**Plan:** .ai-factory/plans/feature-e8-redis.md
**Severity:** high

## Problem

Добавление envRedis в схему потребителя сделало бы REDIS_URL обязательным и сломало startService в observability.spec.ts и контекст messaging.spec.ts; кроме того план копировал startService в новый redis.spec.ts

## Root Cause

План не проверил всех, кто разбирает serviceEnvSchema потребителя

## Solution

REDIS_URL добавлен в startService и vi.stubEnv messaging.spec.ts; тесты Redis — в observability.spec.ts с общим startService; mode 0o644 у aclfile

## Prevention

При новом обязательном ключе окружения в проекте-потребителе искать все запуски сервиса и контексты на serviceEnvSchema

## Tags

#consumer #env #side-effects
