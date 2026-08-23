# 018 — Log correlation and temporary code instrumentation (Phase 3 complete)

**Date:** 2026-08-23
**Branch:** phase-1-mvp

Closes out Phase 3's remaining two items (§13): log correlation and
temporary code instrumentation mode. Network correlation (015) and
structured report generation (017) were already done.

## Log correlation

`observe`/`reproduce`/`investigate` already captured native-log text and
network activity independently — this merges them into one chronologically
ordered timeline instead of leaving a reader to mentally interleave two
separate evidence blobs.

**The hard part was doing this safely, not the merging itself.** Native-log
lines and network events come from two different capture paths, and naively
displaying both as wall-clock times risked a silent, misleading bug: logcat's
default line format has no year and is in the device's local timezone, while
`networkActivity`'s timestamps are raw epoch microseconds. Converting the
former to an absolute instant without knowing the device's timezone (which
may or may not match the host machine running the orchestrator) could
produce a timeline that's *wrong by exactly one timezone offset* without
looking wrong.

Fix: switched `native-log.ts`'s logcat call from the default format to
`-v epoch`, which prefixes every line with a raw epoch-seconds number — the
same absolute-clock basis as `networkActivity`'s timestamps, no timezone
involved at all. `log-correlation.ts` parses both into a common
milliseconds-since-epoch number, sorts, and — since displaying an absolute
instant still isn't needed for what "correlation" is actually for — renders
the result as **elapsed time from the first event** (`+0ms`, `+1324ms`, ...),
which sidesteps ever having to print a clock time (and thus a timezone) at
all. `generateReport` includes one representative timeline (the first
anomalous run) under a "Timeline" section.

## Temporary code instrumentation

New granular tools `instrument_code` / `revert_instrumentation`: for bugs
that don't show up in any existing evidence stream, temporarily insert a
line of code (typically a `print`) into the app's own source, `hot_reload`
to pick it up, observe again — then revert.

**This writes to the user's actual source files, so safety was the design
constraint, not the mechanism:**
- `filePath` is resolved relative to the app root and refused if it resolves
  outside it (`path.relative` starts with `..`) — this tool must never be
  usable to touch an arbitrary file elsewhere on the machine.
- The original file content is backed up in memory on first touch and never
  overwritten by a second `instrument_code` call on the same file — so
  reverting always restores the *true* original, not an intermediate edited
  state, even if instrumentation was applied more than once.
- `close_app` now reverts anything still instrumented automatically, so a
  forgotten `revert_instrumentation` call can never leave the app's real
  source mutated after the session ends.

**Real bug found via live testing, fixed**: the first live test used
`afterLine=22` intending "insert after 0-indexed line 22" — but the
implementation was `lines.splice(afterLine, 0, code)`, which inserts
*before* whatever's at that index, not after it. The print landed one line
too early, before the variable it referenced was even declared. The self-check
alone never caught this: it asserted against whatever `splice` actually
produced rather than independently checking the parameter against its own
documented meaning. Fixed by renaming the parameter to `atLine` and rewriting
its description around what the code actually does (a 0-indexed insert
*position*, not "insert after this line") instead of changing the splice
logic itself — the safest fix was making the name honest, not the behavior
different. Confirmed correct on retest: `atLine: 23` landed the new line
exactly as the file's line 24, immediately after the target line.

**Known gap, not fixed**: `native-log.ts`'s logcat capture is filtered to
`flutter:E` (error level only) — deliberate, to avoid noise for the tier-1
`native-log-exception` rule (009). A plain `print()` statement inserted via
`instrument_code` logs at a lower level and won't show up in `observe()`'s
`nativeLog` field as a result — the mechanism (insert/reload/revert) is
correctly verified end-to-end, but seeing the print's actual output today
requires reading `adb logcat` directly rather than through `observe()`.
Worth widening the level filter (or adding a separate always-inclusive
capture) later if this gets used for real debugging.

## Verified

- `log-correlation.ts`: self-checked directly — merges native-log +
  multi-event network requests into correct chronological order, empty
  inputs produce an empty timeline, malformed network JSON doesn't throw.
- `instrumentation.ts`: self-checked directly — insert/read-back, a second
  instrument call on the same file keeps the *original* backup rather than
  the already-edited version, revert restores exact original content and
  clears its backup entry, reverting a never-touched file returns `false`
  without erroring, a path-traversal attempt (`../../etc/passwd`) is
  refused, and `revertAll` correctly restores multiple files at once.
- **Live device verification, both pieces, against `killer_demo_app`:**
  - `investigate`'s `report` field rendered a correct "Timeline" section —
    network events in true chronological order (`+0ms` through `+726ms`),
    consistent with the confirmed `expected-element-missing` finding.
  - `instrument_code` → `hot_reload` → trigger the flow → confirmed via raw
    `adb logcat` that the inserted print fired with real data: `"fetched 5
    tasks but _tasks stays 0"` — direct, first-hand confirmation of the
    app's actual bug (the fetch succeeds, the assignment never happens).
  - `revert_instrumentation` restored the file to a byte-for-byte match of
    the committed original (`git diff` empty afterward).

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/native-log.ts` | logcat now uses `-v epoch` |
| `packages/orchestrator/src/log-correlation.ts` | New — `buildTimeline` |
| `packages/orchestrator/src/reproduction.ts` | `RunResult` gained `nativeLog` (was captured but previously discarded after the tier-1 check) |
| `packages/orchestrator/src/report.ts` | Includes a "Timeline" section when correlatable evidence exists |
| `packages/orchestrator/src/instrumentation.ts` | New — `instrumentFile`/`revertFile`/`revertAll` |
| `packages/orchestrator/src/session.ts` | `instrumentCode`/`revertInstrumentation`, `closeApp` auto-reverts |
| `packages/orchestrator/src/index.ts` | Registered `instrument_code`/`revert_instrumentation` tools |
