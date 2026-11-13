# Сверка API drizzle, Db и Fastify в задачах 2a, 2c, 3a

**Date:** 2026-11-13 18:27
**Plan:** .ai-factory/plans/fix-rc8-transition-findings.md
**Severity:** medium

## Problem

2c: undefined в drizzle .set пропускается; 3a: db.read требует тенанта; 2a: статус 200/201 и Content-Type text/csv без charset

## Root Cause

Поведение библиотек и Db взято по памяти, без чтения исходников

## Solution

2c — явный null; 3a — db.readGlobal; 2a — статус 201, Content-Type сравнивается между первым ответом и повтором

## Prevention

Перед задачей с записью или чтением через drizzle и Db проверять mapToDriverValue/set и сигнатуры Db в src/database/db.ts

## Tags

#description #library-api
