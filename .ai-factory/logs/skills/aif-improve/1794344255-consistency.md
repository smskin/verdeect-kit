# Iteration 4: consistency after requirePeer change

**Date:** 2026-11-10 20:57
**Plan:** .ai-factory/plans/feature-e4-database-idempotency
**Severity:** medium

## Problem

Db factory lacked drizzle driver; lint message and ARCHITECTURE still described TLA loadPeer; consumer risk note contradicted test

## Root Cause

Earlier fix changed a mechanism without sweeping all references

## Solution

Async Db factory with loadDrizzle, lint texts, DEVIATION П15 headers and README note, risk wording

## Prevention

After a mechanism change, grep the bundle for the old mechanism name

## Tags

#consistency #architecture
