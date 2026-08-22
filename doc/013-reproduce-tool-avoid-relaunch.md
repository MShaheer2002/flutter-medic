# 013 — `reproduce` tool: avoid the terminate-and-relaunch waste

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done

Fixed a real inefficiency the user caught directly: the 012 live investigation did `launch_app` (explore) → `close_app` → `investigate` (which launches the app fresh again) to get the reproduced verdict — a full terminate-and-relaunch just to verify what exploration had already found, when `hot_restart` (already used *inside* `investigate`'s own reproduction loop) could reset state just as well without ever leaving the app.

## Why `investigate` couldn't just be reused directly

`investigate` is deliberately self-contained — it owns its whole lifecycle (launch → connect → reproduce → close) so it works standalone with zero setup. That's also exactly why it can't safely run *while* a `launch_app` session is already open: two independent Marionette/Dart-MCP connections to the same device would conflict (the single-binding-style lesson from Phase 0). So closing the exploration session before calling `investigate` wasn't a mistake — but doing a **second full launch** right after was avoidable, since the app was already running a moment before.

## The fix

Extracted the reproduction loop (the part that runs steps N times with `hot_restart` between attempts, applying the tier-1 rules) out of `investigate.ts` into its own module, `reproduction.ts`, taking already-connected `marionette`/`dartMcp` clients rather than owning the connection lifecycle itself. Two callers now share it:

| File | Action |
|---|---|
| `packages/orchestrator/src/reproduction.ts` | created | The extracted loop: `reproduce(marionette, dartMcp, deviceId, applicationId, appPath, steps, expectedElementKey)` — never launches or closes anything, just runs and hot-restarts |
| `packages/orchestrator/src/investigate.ts` | simplified | Now: launch → connect → call the shared `reproduce()` → close. Behavior unchanged (regression-tested) |
| `packages/orchestrator/src/session.ts` | modified | New exported `reproduce(steps, expectedElementKey?)` — requires an active `launch_app` session, calls the same shared loop against the session's already-open connections. No launch, no close |
| `packages/orchestrator/src/index.ts` | modified | New `reproduce` MCP tool; `investigate`'s description updated to point to it ("use reproduce instead" once a session is already open) |

## The corrected workflow

Before: explore (`launch_app`/`observe`/`tap`) → `close_app` → `investigate` (full relaunch) → verdict.
Now: explore (`launch_app`/`observe`/`tap`) → `reproduce` (hot-restarts the already-running app 3x) → verdict → `close_app` only when actually done.

One real app launch for the whole investigation, not two.

## Verified

Regression-tested `investigate` via the CLI after the extraction — identical result to every prior run (killer-demo app, reproduced 3/3, `"confirmed"`).

**Live-verified the actual fix, after the session restart**, through the real MCP path against `crash_demo_app`: `launch_app` → `observe` (login screen) → `enter_text` ×2 → `tap` → `observe` (found the crash again) → `reproduce` with the discovered steps — reproduced 3/3, `"confirmed"`, identical `runtime-exception` signal to `investigate`'s output.

**The decisive check**: captured the app's OS-level PID via `adb shell pidof` right after `launch_app` (`7537`), then again after `reproduce`'s three hot-restart cycles completed. **Identical PID before and after** — proof the app process was never relaunched, only hot-restarted, exactly as designed. `close_app` afterward correctly force-stopped it (confirmed via `ps -A`), so the earlier cleanup fix (010) still holds too.
