# Итерация 6: зависимости от TestConsumer и фикстуры outbox

**Date:** 2026-11-11 11:46
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** medium

## Problem

Задачи 27, 28, 31 и 34 используют TestConsumer из задачи 26, но от неё не зависели; задача 21 использует fixtures.outbox и kit.outbox из задачи 7 без зависимости

## Root Cause

Общий компонент тестов определён внутри задачи с тестами, и его потребители его не объявили

## Solution

Добавлены зависимости 21→7 и 27/28/31/34→26; обновлены Cross-Phase Dependencies и заголовки фаз 7 и 8

## Prevention

Для каждого общего компонента test/support проверять, что каждая использующая его задача зависит от задачи-владельца

## Tags

#dependencies
