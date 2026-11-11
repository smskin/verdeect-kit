# KIT_REDIS в client.ts вместо модуля

**Date:** 2026-11-11 18:22
**Plan:** .ai-factory/plans/feature-e8-redis.md
**Severity:** medium

## Problem

Токен KIT_REDIS объявлялся в kit-redis.module.ts, который импортирует RateLimiter и KitRedisChannels, внедряющие этот токен

## Root Cause

План не учёл цикл ESM-импортов между модулем Nest и его провайдерами

## Solution

KIT_REDIS объявлен в src/redis/client.ts (задача 2), задачи 4 и 5 зависят от 2

## Prevention

DI-токены, которые внедряют провайдеры модуля, объявлять в листовом файле, а не в файле модуля

## Tags

#dependencies #esm-cycle
