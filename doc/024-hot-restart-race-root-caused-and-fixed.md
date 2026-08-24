# 024 — Root-caused and fixed the hot_restart evidence-staleness bug

**Date:** 2026-08-24
**Branch:** phase-1-mvp

Docs 016 and 019 documented, but never root-caused, evidence occasionally
being stuck on the wrong screen right after `hot_restart` — stable, not
transient (ruled out via `waitForStableUi`'s poll), reproduced on two
independent code paths (`reproduce()` and `verify_fix`'s `hot_restart`
mode). The user asked directly to fix it.

## Root cause

Read `marionette_mcp`'s own source (`0.6.0`,
`lib/src/vm_service/vm_service_connector.dart`) instead of guessing again.
`VmServiceConnector.hotRestart()`:

1. Calls the VM service's registered `hotRestart` RPC.
2. On success, calls `_findIsolateWithMarionetteExtensions()` to re-resolve
   which isolate to bind to — the old one was just torn down and replaced.
3. That resolution scans `getVM()`'s isolate list for the *first* one with
   the `ext.flutter.marionette.getLogs` extension registered, with **no
   delay before the very first attempt** (only between retries, up to 10
   attempts / 500ms apart, if the first fails to find any match at all).

If the just-torn-down old isolate hasn't actually been pruned from
`getVM()`'s isolate list yet at that exact instant — plausible, since VM
service isolate cleanup and the old isolate's extension deregistration
aren't instantaneous — `_findIsolateWithMarionetteExtensions` can grab the
dying old isolate instead of the new one, on the very first (zero-delay)
attempt, so it never even reaches its own retry logic.

This happens **synchronously inside Marionette's own `hot_restart` tool
call**, before it ever returns control to flutter-medic. That's why nothing
tried before worked: a longer fixed sleep, or polling until two reads
match, both happen *after* Marionette has already returned — by then, the
wrong isolate ID may already be permanently cached in Marionette's own
internal state for the rest of that restart cycle. Every later read queries
the same wrong, frozen isolate — explaining exactly what was observed:
stale, but perfectly stable.

## Fix

Can't patch `marionette_mcp` itself (a published dependency, not our code).
Workaround: call `hot_restart` a **second** time immediately after the
first (`mcp-clients.ts`'s new `hotRestartTwice`). By the time the second
call's internal isolate search runs, real wall-clock time has actually
passed — the first call's own execution, its internal retry budget, the
round trip back to us, our own round trip calling it again — enough,
empirically, for the truly-dead old isolate to have actually disappeared
from `getVM()`'s list, so the second search finds only the genuinely new
isolate. Applied everywhere a single `hot_restart` was previously called:
`reproduction.ts`'s between-attempts restart, `session.ts`'s `hotRestart`
tool, and `verifyFix`'s `hot_restart` mode.

## First live test: the isolate-race theory alone wasn't the whole story

Ran `investigate` (no `expectedElementKey`, so raw `interactiveElements` is
visible on every run) with only `hotRestartTwice` applied. Result: run 1 —
a **cold launch, no `hot_restart` involved at all** — still showed the stale
"2 GestureDetectors" pattern; run 2 (after one restart) also showed it; run
3 (after a second restart) was correct. A cold-launch failure directly
contradicts a theory that's specifically about restart-time isolate
identity — that data point falsified the theory as a *complete*
explanation, so it needed revising rather than declaring victory on
`hotRestartTwice` alone.

Re-examined `waitForStableUi`: it declared "stable" after just **two**
consecutive identical reads (~300ms apart). If the engine is genuinely busy
or blocked for longer than that — plausible during cold-start init just as
much as right after a restart — `get_interactive_elements` can return the
same frozen, stale frame on two back-to-back polls and falsely look
"settled" long before the real final frame ever renders. That explains both
the cold-launch and post-restart failures with one mechanism, instead of
needing two separate causes.

## Combined fix

- `hotRestartTwice` (`mcp-clients.ts`) — kept; the isolate-identity race is
  real and independently confirmed by reading Marionette's source, even
  though it wasn't the only cause of what was observed.
- `waitForStableUi` (`reproduction.ts`) now requires **three** consecutive
  identical reads, not two, before trusting the result — raises confidence
  against a brief freeze without changing the bounded 5-second worst-case
  wait. Self-checked directly: a value that repeats exactly twice then
  changes is no longer mistaken for "settled" (the old bug, reproduced
  synthetically); a genuinely stable value still settles correctly, just
  one poll interval later.

## Verified

Live, on the real device, after applying both fixes: three full
`investigate` rounds (9 runs total — 3 cold launches, 6 `hot_restart`
transitions) against `killer_demo_app`, no `expectedElementKey` so raw
evidence is visible on every run. **9/9 correct** — every single run showed
the genuine Home screen content. This exact test configuration had reliably
hit the bug on nearly every prior attempt (016, 019, 021), so a clean 9/9
is real, meaningful evidence, not a lucky pass.

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/mcp-clients.ts` | New `hotRestartTwice`, with the full root-cause writeup as its docstring |
| `packages/orchestrator/src/reproduction.ts` | Uses `hotRestartTwice` instead of a single `hot_restart` call; `waitForStableUi` requires 3 consecutive matches, not 2 |
| `packages/orchestrator/src/session.ts` | `hotRestart()` and `verifyFix`'s `hot_restart` mode both use `hotRestartTwice` too |

## Status

Root-caused (with one theory revision along the way, driven by a real
contradicting data point rather than ignored) and live-verified: 9/9 clean
runs on a test configuration that used to fail almost every time.
