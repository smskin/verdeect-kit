# E1: побочный эффект ConfigModule — запись умолчаний в process.env

**Date:** 2026-11-09 19:48
**Plan:** .ai-factory/plans/feature-e1-scaffold-config
**Severity:** medium

## Problem

Тест AC-1.7 полагался на vi.unstubAllEnvs, а @nestjs/config 12.0.1 дописывает разобранные умолчания в process.env, и они утекают между контекстами и файлами

## Root Cause

Поведение сторонней библиотеки не проверялось по исходникам при планировании

## Solution

Задача 12: снимок и восстановление process.env + тест на запись умолчаний; задача 9: TSDoc; задача 33: README

## Prevention

Проверять по исходникам или Context7 побочные эффекты обёртываемых модулей Nest

## Tags

#nestjs-config #test-isolation #ac-1.7
