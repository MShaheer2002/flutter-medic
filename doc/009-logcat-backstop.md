# 009 — Logcat backstop closes the get_runtime_errors gap

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done

Added a third tier-1 anomaly rule, `native-log-exception`, that reads `adb logcat` filtered to the app's process and the engine's own `flutter:E` tag. This directly closes the gap root-caused in entry 007: exceptions that never reach the VM service's `Flutter.Error`/`Stderr` streams (unhandled fire-and-forget async errors) still get printed by the Flutter engine straight to native platform logging — this rule reads that channel directly.

## Why needed

007 explained *why* `get_runtime_errors` misses this error class; this closes the actual capability gap rather than leaving it as a known limitation. Android's own log is the one place this specific error class is genuinely visible (established empirically in 007 by capturing the raw `E/flutter: [ERROR:flutter/runtime/dart_vm_initializer.cc...]` line via `adb logcat`), so that's what this reads.

## Files created / modified

| File | Action | Why |
|---|---|---|
| `packages/orchestrator/src/native-log.ts` | created | `getAndroidApplicationId` (parses `applicationId` from `build.gradle.kts`), `captureLogMarker` (device-local timestamp, for `logcat -T`), `readFlutterLogSince` (scoped by `--pid` when available, falls back to timestamp-only scoping if the process can't be found — e.g. it crashed hard enough to lose its PID) |
| `packages/orchestrator/src/anomaly-detection.ts` | modified | Added `detectNativeLogException` |
| `packages/orchestrator/src/investigate.ts` | modified | Captures a log marker *before* each run's interaction steps (same ordering lesson as the Dart MCP connection — mark/connect before the action, not after), reads the log after, applies the new rule alongside the existing two |

## A false positive found and fixed immediately

First clean-case test run showed `native-log-exception` firing on `"--------- beginning of main"` — that's `logcat`'s own buffer-metadata marker line, not a real log entry (printed when a requested time range starts before the buffer has content). Fixed by filtering out lines starting with `---------` before checking whether anything real remains. Retested clean — zero false positives across 3 runs, `expected-element-missing` still solid.

## Decisive verification

Reused the same temporary-exception-injection technique from 007 (`throw Exception(...)` in `_loadTasks()`, reverted immediately after):

- **Before this fix**: `runtime-exception` (VM-service path) — 0/3. `native-log-exception` didn't exist yet.
- **After this fix**: `native-log-exception` — **3/3**, with the exact captured stack trace (`Unhandled Exception: ... home_screen.dart:26:5`). `runtime-exception` still correctly 0/3 — confirms the VM-service limitation is unchanged and specifically what this new rule backstops.

Clean-case retest (real bug, no injected exception): `native-log-exception` — 0/3, `expected-element-missing` — 3/3, exactly as expected.

## Mental model

Phase 1's anomaly detection now has three independent tier-1 signals: a general widget-tree check (works for any app, given a caller-supplied expectation), a VM-service exception check (works for framework/zone-caught errors), and a native-log exception check (works for the error class the VM-service check structurally can't see, Android-specific). Together they cover meaningfully more of the real bug space than any one alone — and each one's actual coverage boundary is now known and tested, not assumed.
