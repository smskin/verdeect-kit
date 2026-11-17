# AC-1.3: проверка значения в логе и JSON CLI при утечке

**Date:** 2026-11-17 19:36
**Plan:** .ai-factory/plans/fix-rc12-identity-transition.md
**Severity:** medium

## Problem

Отсутствие значения в fatal-логе и JSON CLI проверялось только на ошибке без утечки

## Root Cause

Тесты задач 2 и 3 строили ошибку вручную, без страховки parseEnv

## Solution

Добавлены тесты с ошибкой parseEnv из superRefine со значением: fatal-лог, событие, environmentFailure

## Prevention

Каждое звено AC «в ошибке, логе и JSON» проверять на входе, который действительно вызывает утечку

## Tags

#test-coverage #ac-1-3
