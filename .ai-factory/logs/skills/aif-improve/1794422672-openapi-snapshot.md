# GET /limited потребителя без @Api

**Date:** 2026-11-11 18:44
**Plan:** .ai-factory/plans/feature-e8-redis.md
**Severity:** medium

## Problem

Задача 17 добавляла контроллер в AppModule потребителя, не уточнив @Api; по образцу соседних контроллеров @Api изменил бы документ и сломал снимок contracts/openapi.json (AC-3.8)

## Root Cause

Не учтён снимок OpenAPI, который строится из того же AppModule

## Solution

Маршрут без @Api, снимок не меняется

## Prevention

Новый маршрут в модуле со снимком контракта — явно решать: @Api + обновление снимка или без @Api

## Tags

#consumer #openapi
