# Сброс ACL LOG в тестах AC-8.1 и AC-8.5

**Date:** 2026-11-11 18:46
**Plan:** .ai-factory/plans/feature-e8-redis.md
**Severity:** medium

## Problem

Проверка «ACL LOG пуст» в ac-8-1 шла после NOPERM-случаев того же файла при общем beforeAll со сбросом; в ac-8-5 сброса не было, а журнал общий для сервера

## Root Cause

Не учтено, что ACL LOG — состояние всего сервера Redis, общего для файлов прогона

## Solution

ac-8-1: случай — первым, свой describe с ACL LOG RESET; ac-8-5: свой ACL LOG RESET в beforeAll

## Prevention

Серверное состояние общего контейнера (журналы, счётчики) сбрасывать в том же describe, что проверяет его

## Tags

#test-isolation #redis
