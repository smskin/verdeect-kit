# rc.8: комбинация dlq v1+v2, jsonb-порядок ключей [OPEN], срок очереди pg-pool в 3a

**Date:** 2026-11-13 19:09
**Plan:** .ai-factory/plans/fix-rc8-transition-findings.md
**Severity:** medium

## Problem

Строка таблицы AC-5.22 (on v1 и v2 с dlq) без теста доставки; 2a сравнивал сырой payload при jsonb-нормализации ключей; 3a не учитывал connectionTimeoutMillis 5000 для ожидания в очереди pg-pool

## Root Cause

Таблица комбинаций и тесты расходились; поведение jsonb и pg-pool не сверено с кодом

## Solution

1a: TestConsumerDlqV2 и тест доставки v1/v2; 2a: тело {} у /echo и [OPEN] о порядке ключей — спросить до 2c; 3a: отпускать клиента сразу и проверять успех

## Prevention

Каждой строке таблицы комбинаций — тест; сверять семантику хранилища (jsonb) и сроков пула с требованием

## Tags

#test-coverage #open-question #pg-pool #jsonb
