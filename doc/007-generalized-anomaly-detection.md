# 007 — Generalized anomaly detection

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done

Removed the hardcoded, single-app, single-string anomaly check from Phase 1's proof-of-loop and replaced it with a real, parameterized system: `investigate` now accepts `appPath`, `goal`, arbitrary `steps` (tap/enter_text), and an optional `expectedElementKey`, and runs two tier-1 rules from a new `anomaly-detection.ts` module — `detectMissingExpectedElement` and `detectRuntimeException`. Also wired Dart MCP in as a second MCP client alongside Marionette, specifically to query `get_runtime_errors`.

## Why needed

The orchestrator from entry 006 could only ever investigate one specific app's one specific known bug — it wasn't a general tool, just a working demo. This turns it into something that could genuinely investigate a different app, a different flow, a different expected outcome, as long as the caller supplies the steps and expectation (still no NL planning — that's real future work).

## Files created / modified

| File | Action | Why |
|---|---|---|
| `packages/orchestrator/src/anomaly-detection.ts` | created | The tier-1 rules as their own reusable module, matching the tiered anomaly-detection design drafted earlier in this project |
| `packages/orchestrator/src/investigate.ts` | rewritten | Parameterized (`appPath`, `goal`, `steps`, `expectedElementKey`), connects Dart MCP alongside Marionette, applies both tier-1 rules, closes both MCP clients before returning (see bugs below) |
| `packages/orchestrator/src/index.ts` | modified | Tool schema updated to match — `investigate` now takes real parameters, not just a device ID |

## Two real bugs found and fixed along the way

1. **Node's `process.exit()`-after-`console.log()` truncation.** Calling `process.exit()` immediately after `console.log()` can cut off output when stdout is a pipe (not a TTY) — Node's console writes to pipes aren't guaranteed synchronous. Fixed by using `process.exitCode` and letting the process exit naturally once its work is done — which in turn required actually closing both MCP clients (`marionette.close()`, `dartMcp.close()`) so their child processes don't keep the event loop alive forever. Caught this because the CLI script's output kept coming back completely empty despite a clean exit code — that mismatch was the tell.
2. **CLI entry-point guard never matched.** `import.meta.url === 'file://' + process.argv[1]` is wrong when the script is invoked with a relative path (`node dist/investigate.js`, not an absolute one) — `import.meta.url` is always absolute, `process.argv[1]` isn't. The guard silently never matched, so the CLI code path never ran at all; the script just loaded and exited with nothing to do. Fixed with `pathToFileURL(process.argv[1]).href`, the correct way to do this comparison in Node ESM.

## A real, honest limitation found — not fixed, documented

Verified the `expected-element-missing` rule rigorously: it correctly fired 3/3 against the real (silent, no-exception) killer-demo bug, both before and after all the fixes above.

The `runtime-exception` rule is a different story. Injected a real `throw Exception(...)` into `home_screen.dart` temporarily to test it — confirmed via the raw Flutter console (`E/flutter: [ERROR:flutter/runtime/dart_vm_initializer.cc] Unhandled Exception: ...` with a full stack trace) that Flutter's own runtime absolutely reports this exception. But `get_runtime_errors` (Dart MCP) never saw it — not because of a connection-timing bug (verified: connecting *before* the interaction steps, not after, made no difference), not because of a stale/wrong DTD URI (verified: logged and confirmed the exact URI connected to). The exception is a genuine, framework-reported error that this specific tool call simply doesn't seem to catch for this pattern (an unhandled exception in a fire-and-forget async call — `_loadTasks()` is called from `initState()` without being awaited).

Root cause not found — this is analogous to the Patrol investigation in Phase 0: thoroughly checked, several real hypotheses ruled out, genuinely unresolved. Kept the `runtime-exception` rule in the code anyway (it's not doing harm — correctly reports "clean" for genuinely clean runs, and would very plausibly still catch synchronous/build-time framework errors, a more common crash pattern than this specific async edge case). This is a known gap, not a claimed capability.

## Mental model

The killer-demo app's bug is deliberately the *harder* case — no exception, no crash, nothing a naive "check the logs for errors" approach would ever find. The rule that catches it (`expected-element-missing`) is proven solid. The rule meant to catch the *easier* case (a real crash) turned out to have its own real gap. Both are now documented precisely enough that whoever picks this up next — including future me — doesn't have to rediscover any of this.
