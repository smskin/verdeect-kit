# Контракт логгера /redis и проверки подключения под ACL

**Date:** 2026-11-11 18:30
**Plan:** .ai-factory/plans/feature-e8-redis.md
**Severity:** medium

## Problem

Задачи 2–5 отсылали к логгеру /messaging, импорт которого запрещён правилом ESLint; не учтены console.warn ioredis при отказе INFO и немые CLIENT SETNAME/SETINFO; servicesOf rabbitmq приватный

## Root Cause

План ссылался на образец другого подпути, не проверив правила импортов и поведение драйвера при ACL

## Solution

RedisLog, redisNestLog и KIT_REDIS_LOG в задачах 2–5; D9 с console.warn и SETINFO; ACL LOG RESET до подключения; локальная копия servicesOf и случай повтора имени

## Prevention

Ссылаясь на образец другого подпути, проверять, разрешает ли таблица импортов его переиспользовать; для драйвера под ACL проверять команды, которые он шлёт сам при подключении

## Tags

#logging #acl #cli
