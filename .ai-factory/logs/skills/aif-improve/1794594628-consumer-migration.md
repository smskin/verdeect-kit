# Генерация миграции потребителя и тип заголовка

**Date:** 2026-11-13 18:30
**Plan:** .ai-factory/plans/fix-rc8-transition-findings.md
**Severity:** medium

## Problem

2b: drizzle-kit generate на месте в test/consumer/minimal не работает (file:__TARBALL__); 2c: getHeader не всегда строка

## Root Cause

Устройство проекта-потребителя и тип getHeader в Fastify не проверены

## Solution

2b — генерация во временной копии с архивом по образцу bcb1888; 2c — только typeof string, как location

## Prevention

Для миграций потребителя смотреть consumer-project.ts и прецедент bcb1888

## Tags

#migration #consumer
