# 012 — Second demo app; setting up a live NL-driven investigation

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

## Next (blocked on a session restart)

Once `flutter-medic`'s tools are live again: perform the actual test — given only a natural-language goal like *"check if the profile screen works after logging in"*, use `launch_app` → `observe` → reason about what's on screen → `tap`/`enter_text` → `observe` again → reason about the result, with zero pre-written steps or expected-element parameter, and see whether the crash is discoverable through pure exploration. Then hand off what's learned to `investigate` for the rigorous 3x-reproduction verdict. This is the actual proof Phase 2's architecture works, not just that the tools exist and pass isolated tests.
