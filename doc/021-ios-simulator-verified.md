# 021 — iOS Simulator live-verified, found and fixed a real false-positive

**Date:** 2026-08-24
**Branch:** phase-1-mvp

020 shipped Phase 5's iOS support entirely unverified, by explicit user
choice. The user then enabled an iOS Simulator (iPhone 16 Pro Max, iOS 18.6)
and asked for it to actually be tried. This entry is that first real test.

## What happened

Ran `investigate` against `killer_demo_app` targeting the booted simulator's
UDID directly through the real MCP tool. First launch took several minutes
(a full Xcode compile for the simulator target — much slower than Android's
incremental build, expected and not a bug).

**The core path worked correctly, first try**: device resolution correctly
identified it as `platform: "ios"`, `flutter run -d <udid>` launched it,
Marionette/Dart MCP connected over the VM service exactly as they do on
Android (confirming the "should work in principle, VM-service-based tools
are platform-agnostic" claim from 020 — this time actually checked, not
trusted), the same bug reproduced 3/3 (`expected-element-missing`,
`tasks_list` absent, "No tasks to show." rendered), network correlation
captured a real `GET /tasks → 200 OK`, and the report/timeline rendered
correctly.

**But `native-log-exception` false-fired on all 3 runs.** The description
was: `"An error was logged via the native \"flutter\" log tag: Timestamp
Ty Process[PID:TID]"` — that's not a real log line, it's `log show`'s own
column header row, printed even when zero real entries match the predicate.
`readIosLogSince` never filtered it, so `detectNativeLogException`'s "any
non-empty content = anomaly" logic treated the header as evidence of a real
error on every single run.

This is the exact bug class doc/009 already fixed for Android — logcat's own
`"--------- beginning of <buffer>"` marker line needed filtering out from
genuine app output. 020 explicitly flagged this exact kind of thing as a
risk ("should work in principle... needs checking, not trusting") but
couldn't check it without a device. Now it could, and it was wrong, in
exactly the anticipated way.

## Fix

Extended `detectNativeLogException`'s existing filter (which already
stripped Android's `---------` marker) to also strip lines starting with
`"Timestamp"` — `log show`'s header. Same function, same filtering pattern,
now covers both platforms' tool-noise instead of just Android's.

## Verified

- Self-checked directly: the exact false-positive string from the live run
  now correctly returns no signal; a real error following the same header
  still correctly fires; Android's existing filter still works unchanged.
- Live re-verification against the same booted simulator: pending a session
  restart (this fix isn't loaded into the running MCP server yet).

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/anomaly-detection.ts` | `detectNativeLogException` also filters `log show`'s header line |
