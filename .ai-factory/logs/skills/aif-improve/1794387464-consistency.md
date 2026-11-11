# Итерация 1 +check: channelOutcome, outbox-confirm, публикация в потребителе

**Date:** 2026-11-11 08:57
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** high

## Problem

T25 ждал channelOutcome, не описанный в T14; T23 утверждал, что attempts не растёт вопреки T20 и O; T35 публиковал через POST /companies без издателя токенов; T36 условно расширял runInConsumer; T13 содержал внутренний спор

## Root Cause

Связанные контракты описаны в разных задачах без сверки; допущение о тестовом токене не проверено

## Solution

channelOutcome добавлен в T14; T23 по O (attempts > 0); публикация процесса — строкой outbox из SQL; runInConsumer с env; T13 — одна процедура

## Prevention

Для каждого API, на который ссылается задача, проверять его определение в задаче-источнике; для тестов процесса — проверять доступность аутентификации

## Tags

#consistency #consumer #check
