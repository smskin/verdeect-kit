# Конструктор InvalidEnvironmentError — в TSDoc, README и «Как перейти»

**Date:** 2026-11-17 19:43
**Plan:** .ai-factory/plans/fix-rc12-identity-transition.md
**Severity:** medium

## Problem

R1 меняет публичный конструктор (keys → issues), задачи 10–11 об этом молчали; BFF, Platform, Orchestrator создают ошибку сами

## Root Cause

Смена сигнатуры принята как внутренняя деталь, вызывающие в сервисах не проверены

## Solution

Task 1 TSDoc, Task 10 README API, Task 11 Changed и «Как перейти»

## Prevention

При смене сигнатуры публичного класса — grep вызовов в репозиториях сервисов (только чтение)

## Tags

#breaking-change #changelog
