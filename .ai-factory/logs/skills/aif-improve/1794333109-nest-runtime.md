# Поведение NestFactory и обвязка потребителя

**Date:** 2026-11-10 17:51
**Plan:** .ai-factory/plans/feature-e3-http-framework.md
**Severity:** high

## Problem

app.close через присваивание теряется на прокси NestFactory; abortOnError по умолчанию вызывает process.exit; логи потребителя переехали в stdout; typeof import не проходит lint; у потребителя нет version для OpenAPI; drizzle-orm только авто-peer

## Root Cause

Допущения о Nest и потребителе не сверены с node_modules/@nestjs/core и существующими спеками

## Solution

Object.defineProperty + NestApplication.prototype.close; abortOnError: false; разбор stdout; import type * as NestTesting; version 0.0.0 и INVALID_PACKAGE_JSON; drizzle-orm в devDependencies

## Prevention

Проверять прокси и умолчания фреймворка в node_modules и поток вывода в существующих спеках

## Tags

#nest #consumer #lint #deps
