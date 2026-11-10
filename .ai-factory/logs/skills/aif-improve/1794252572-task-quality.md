# E1: уточнены задачи 16, 22, 23, 25, 28, 30

**Date:** 2026-11-09 19:29
**Plan:** .ai-factory/plans/feature-e1-scaffold-config
**Severity:** medium

## Problem

skipLibCheck: false у потребителя ломал бы tsc на чужих .d.ts; поля ProvidedContext без TSDoc валили бы lint; regex образов пропускал ${VAR:-image}; тест AC-1.2 не проверял отсутствие pg

## Root Cause

План писался по эталонам без прогона правил lint и без форм интерполяции compose

## Solution

skipLibCheck: true; TSDoc у полей ProvidedContext; expandDefaults перед поиском образа + 2 случая AC-1.8; тест AC-1.2 проверяет отсутствие pg и testcontainers

## Prevention

Сверять задачи с собственными правилами lint плана и с формами интерполяции compose

## Tags

#task-quality #lint #compose #ac-1.2
