# E1: timingGuard пропускает проверку при любой ошибке docker ps

**Date:** 2026-11-09 19:45
**Plan:** .ai-factory/plans/feature-e1-scaffold-config
**Severity:** low

## Problem

Только ENOENT считался отсутствием docker; при остановленном демоне test:timing падал бы

## Root Cause

План сузил bare catch эталона до одного кода ошибки

## Solution

composeProjects → null при любой неудаче execFile; unit-случай с code 1 через defaultComposeProjects(exec)

## Prevention

Сохранять семантику обработки ошибок эталона, сужение — только по требованию

## Tags

#timing #docker #error-handling
