# Ленивые соединения и форма экспорта ioredis

**Date:** 2026-11-11 18:33
**Plan:** .ai-factory/plans/feature-e8-redis.md
**Severity:** medium

## Problem

Тесты CLIENT LIST ждали подписочное соединение без subscribe при lazyConnect; загрузчик ioredis копировал module.default из loadPg, что при NodeNext типизируется как module.exports; условный пункт задачи 12 ничего не делал

## Root Cause

План не сверил опции драйвера (lazyConnect) с проверками тестов и форму CJS-экспорта пакета

## Solution

subscribe перед CLIENT LIST и DI-проверка отсутствия провайдера; loadIoredis через module.Redis; пункт start-test-stack убран

## Prevention

Для ленивых соединений тест сначала выполняет команду на нужном соединении; для CJS-peer проверять built/index.js и index.d.ts перед выбором default или именованного экспорта

## Tags

#testing #ioredis #esm
