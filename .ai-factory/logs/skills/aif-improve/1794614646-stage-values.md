# Латинские значения stage и сброс currentStage

**Date:** 2026-11-14 00:04
**Plan:** .ai-factory/plans/fix-rc9-stop-accepting-order.md
**Severity:** medium

## Problem

Значения stage были кириллицей ('2а'), сброс currentStage на шагах 3–5 не был задан, запуск одного файла T не был указан

## Root Cause

Обозначения этапов перенесены из прозы PRD в машинные значения без проверки алфавита

## Solution

stage — '2a'/'2b' в коде, логах и тестах; currentStage = null на шагах 3–5; pnpm test:timing <файл> после uptime

## Prevention

Машинные значения из PRD переводить в ASCII и сверять с правилом base.md об идентификаторах

## Tags

#naming #logging #description
