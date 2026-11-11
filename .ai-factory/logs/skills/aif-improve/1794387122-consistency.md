# Сборка провайдеров OutboxStore и импорт событий в globalSetup потребителя

**Date:** 2026-11-11 08:52
**Plan:** .ai-factory/plans/feature-e5-messaging
**Severity:** high

## Problem

Задача 19 описывала провайдер OutboxStore иначе, чем задача 20 (цикл зависимостей); globalSetup потребителя импортировал события из dist статически — до tsc

## Root Cause

Связанные решения записаны в двух задачах; не учтён подъём статических import в ESM

## Solution

Задача 19 ссылается на решение задачи 20; события импортируются динамически после сборки, общий build-service.ts

## Prevention

Решение о проводке DI — в одном месте; для артефактов сборки в globalSetup — только динамический import()

## Tags

#consistency #esm #consumer
