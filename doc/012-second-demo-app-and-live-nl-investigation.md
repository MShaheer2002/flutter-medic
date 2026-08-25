# 012 — Second demo app; live NL-driven investigation, Phase 2 proven

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done (in progress)

Built `examples/crash_demo_app` — a second demo app, deliberately different in bug shape from `killer_demo_app`, to genuinely test generality rather than assume it. Login → Profile, where the fake API returns a profile with `bio: null`, and `profile_screen.dart` does `_profile!['bio']!.toUpperCase()` in `build()` — a real, permanent, synchronous null-assertion crash, not a silent state bug and not the fire-and-forget async pattern already tested in 007/009.

## Why this specific bug, on purpose

Three distinct bug classes now exist across the two demo apps:
1. `killer_demo_app`'s original bug — silent, no exception at all, caught only by `expected-element-missing`.
2. The fire-and-forget async exception (007/009, injected temporarily for testing) — caught only by `native-log-exception`, invisible to `runtime-exception`.
3. `crash_demo_app`'s bug (this entry) — a **synchronous build-time crash**, the most common real-world Flutter bug shape, which should go through Flutter's normal `FlutterError.onError` path and — unlike class 2 — actually be visible to `runtime-exception`, the primary VM-service rule that's been otherwise unproven against a real, standing bug.

This is the first standing (non-temporary, non-reverted) crash bug in the project, and the first real test of whether `runtime-exception` works at all for the bug class it was originally built for.

## The real constraint that determined what happens next

Attempted to run a live, step-by-step investigation using only the granular tools (`launch_app`/`observe`/`tap`/`enter_text`), driven by nothing but a plain-language goal — no pre-written steps, no pre-known expected element — to prove Phase 2's actual architecture (calling agent reasons between tool calls), not just that the tools exist.

Hit a real, worth-recording constraint: `session.ts`'s state lives in one running Node process's memory. Separate `node -e ...` invocations from a shell each start a fresh process with no memory of the last — there's no way to fake a multi-step granular interaction that way. This is exactly what the MCP server architecture is for: one long-running process (`node dist/index.js`, already what `flutter-medic` runs), called via many separate tool invocations that share that process's memory. Re-registered `flutter-medic` (local scope, no approval prompt) — needs a session restart before its tools are callable, same as every other new-server registration this project has hit.

## Files created

| File | Action |
|---|---|
| `examples/crash_demo_app/` | New Flutter app — Login → Profile, `MarionetteBinding` wired in, `flutter analyze` clean |
| `lib/profile_api.dart` | Fake backend, always succeeds, `bio: null` on purpose — the bug is never here |
| `lib/login_screen.dart` | Same pattern as `killer_demo_app`'s (`email_field`/`password_field`/`login_button` keys) |
| `lib/profile_screen.dart` | The actual bug: `_profile!['bio']!.toUpperCase()` in `build()` |
| `lib/main.dart` | Routes (`/login`, `/profile`), `MarionetteBinding.ensureInitialized()` |

## The live investigation — Phase 2 proven, not just built

After the session restart, ran the actual test through the real MCP path, goal only, no pre-written steps:

1. `launch_app` → auto-detected the device, launched `crash_demo_app`.
2. `observe` → a login screen: two `TextField`s (`email_field`, `password_field`) and an `ElevatedButton` (`login_button`), no errors. Reasoned from this alone: fill in credentials, submit.
3. `enter_text` ×2, `tap login_button`.
4. `observe` again → **`interactiveElements`: "Found 0 interactive element(s)"**, and `runtimeErrors` showed a precise, real exception: *"Null check operator used on a null value"*, with the exact source — `_ProfileScreenState.build (package:crash_demo_app/profile_screen.dart:43:40)`.

Every step of that reasoning chain — recognizing a login form, filling it in, checking the result — came from tool-observed evidence alone, not from prior knowledge of the code. This is the actual proof of the Phase 2 architecture decided in this entry's design: the calling agent plans and judges; the orchestrator only ever hands back raw evidence.

**Also resolves an open question from 007/009**: `runtime-exception` (the primary VM-service rule, via `Flutter.Error` extension events) fired correctly here — the first time it's been tested against a real, standing bug rather than a temporarily-injected one. Confirms it works exactly as designed for the bug class it was built for (synchronous build-time errors); the fire-and-forget async gap documented in 007 is real and specific to that one error class, not a sign the rule is broken generally.

**Closed the loop**: called `close_app`, then `investigate` with the steps just discovered (no `expectedElementKey` needed — the crash itself is the anomaly) — reproduced 3/3, verdict `"confirmed"`, identical `runtime-exception` signal on every run.

## Mental model

This is the moment Phase 2 stopped being "tools that theoretically enable autonomous investigation" and became "autonomous investigation, demonstrated, on a bug that hadn't been deliberately re-examined for this test." The exploration phase (raw evidence, agent judgment) and the verification phase (`investigate`'s mechanical rigor) are now shown working together, not just separately.
