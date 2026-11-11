# Principal check before key in idempotency interceptor

**Date:** 2026-11-10 21:41
**Plan:** .ai-factory/plans/feature-e4-database-idempotency
**Severity:** medium

## Problem

Unguarded @Idempotent route without key would call handler

## Root Cause

Steps ported in reference order without re-checking PRD v1.14 rule

## Solution

Principal check moved before key handling, test without key added

## Prevention

Order guard-like checks by the strongest PRD rule

## Tags

#idempotency #order
