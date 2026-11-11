# Итерация 3 +check: имена в CLI-тестах, таблицы в опциях модуля, провайдер очистки

**Date:** 2026-11-11 10:18
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** medium

## Problem

Имена a,b не проходят формат; фабрикам негде взять таблицы; MessagingCleanup без provide/inject

## Root Cause

Тестовые данные и DI-проводка не сверены с форматом имени и конструкторами

## Solution

svc-a,svc-b; outbox/inbox в KIT_MESSAGING_OPTIONS; провайдер MessagingCleanup с inject

## Prevention

Для каждой фабрики DI проверять источник каждого аргумента конструктора

## Tags

#di #check
