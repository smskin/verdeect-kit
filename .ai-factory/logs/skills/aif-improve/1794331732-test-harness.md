# Сборка dist для T-теста и окружение сервиса-потребителя

**Date:** 2026-11-10 17:28
**Plan:** .ai-factory/plans/feature-e3-http-framework.md
**Severity:** medium

## Problem

Task 19 полагался на несобранный dist; Task 20 запускал сервис со схемой, требующей SERVICE_URLS, без флагов декораторов в tsconfig.json потребителя

## Root Cause

Не сверены существующие тестовые обвязки (timing global-setup, consumer env/tsconfig)

## Solution

Task 19 собирает dist в node_modules/.cache/kit-timing-dist; Task 20 — своя схема сервиса, флаги декораторов, types-check /http

## Prevention

Перед тестовой задачей читать существующие спеки того же уровня и их обвязку

## Tags

#tests #consumer #timing
