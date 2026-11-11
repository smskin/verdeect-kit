# KT-20 quoteIdentifier sweep

**Date:** 2026-11-10 21:14
**Plan:** .ai-factory/plans/feature-e4-database-idempotency
**Severity:** low

## Problem

Task 29 and 13 built SQL identifiers by hand; loadPg listed escapeIdentifier; table.ts import rule contradicted

## Root Cause

KT-20 change not swept through every SQL-building task

## Solution

quoteIdentifier in Tasks 13 and 29, deps on Task 3, import rule clarified

## Prevention

Grep all SQL text builders after introducing a shared escaping helper

## Tags

#sql #consistency
