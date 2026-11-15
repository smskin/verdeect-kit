# WS-фикстура AC-3.9: жизненный цикл сокетов

**Date:** 2026-11-14 00:04
**Plan:** .ai-factory/plans/fix-rc9-stop-accepting-order.md
**Severity:** high

## Problem

Task 2 не задавал удаление сокетов из Set и обработчик error; на новом коде подмена server.close писала бы в закрытый сокет и роняла дочерний процесс

## Root Cause

План описал только кадры протокола, но не состояние сокета между этапами 2a и 2b

## Solution

Сокеты удаляются по close, есть socket.on('error'), запись только в не destroyed и не writableEnded

## Prevention

У ручных сетевых фикстур планировать обработку error и close у каждого сокета

## Tags

#fixture #timing #websocket
