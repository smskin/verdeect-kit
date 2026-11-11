# Role cleanup, consumer drizzle config, isolated count

**Date:** 2026-11-10 21:23
**Plan:** .ai-factory/plans/feature-e4-database-idempotency
**Severity:** medium

## Problem

AC-4.7 afterAll would drop globalSetup roles; consumer config lacked dialect; isolated list count wrong

## Root Cause

Migration of a test to shared fixtures did not revisit its cleanup

## Solution

Removed role drop, added dialect/strict, three isolated files documented

## Prevention

When a test switches to shared fixtures, re-check its teardown

## Tags

#tests #config
