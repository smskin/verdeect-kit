# Итерация 3 +check: enableRLS, цикл DI relay, assertExchange, lint

**Date:** 2026-11-11 09:02
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** medium

## Problem

T6 требовал .enableRLS(), которого нет в E4; T20 inject создавал цикл с OutboxStore; проверка assertExchange отнесена к T17, но не описана там; T3 проверял уже истинное

## Root Cause

Ссылки «как в E4» и «решение — в задаче N» не сверены с кодом и с текстом задачи-получателя

## Solution

enableRLS убран, проверка ENABLE RLS в T7; inject без OutboxStore; случай в T17; T3 — факт

## Prevention

Каждая ссылка «как в E4» — по grep в коде; каждое «решение — задача N» — сверять с задачей N

## Tags

#consistency #check
