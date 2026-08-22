# 015 — Network evidence (HTTP profiling)

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## Why this was never tested before

The spec's own worked example (§6/§8.3) is "API returns 200 + N items, but the
widget shows fewer" — a network-correlation bug. Neither demo app could ever
exercise this: both `killer_demo_app` and `crash_demo_app` use fake in-memory
"APIs" (`Future.delayed` returning a literal list), so there was never a real
HTTP request for the Dart VM service to profile.

## The dead end, and the real root cause

First attempt: a bare `dart run` script making a real HTTP GET, profiled via
`dart-mcp`'s `vm_service` tool (`ext.dart.io.httpEnableTimelineLogging` then
`ext.dart.io.getHttpProfile`). Result: `getHttpProfile` came back with
`requests: []` every time, even though the request definitely happened
(200 OK, body read successfully in the script itself).

Root cause, found by comparing `getVM`'s isolate metadata between the two
cases: a bare `dart run` process reports `"_embedder": "Dart VM"`; a real
Flutter app's isolate reports `"_embedder": "Flutter"`. HTTP timeline
profiling only instruments the Flutter-embedded case — confirmed by rigging
`killer_demo_app` to make a real HTTP call and getting back full, real
request/response data (headers, timing, status) from the identical
`getHttpProfile` call. Since flutter-medic only ever investigates Flutter
apps, this was never a real limitation — the dead end was an artifact of
testing the wrong kind of process.

## What was built

Not a new anomaly *rule* — `observe()`'s existing design is "raw evidence, no
judgment applied; the calling agent decides what it means" (010, 014), and
network correlation is exactly that kind of judgment (does response count
match rendered count? is this even the right endpoint?) that's brittle to
hardcode generically across arbitrary apps. So this adds the evidence source,
the same way `nativeLog` sits alongside `runtimeErrors`:

- `mcp-clients.ts`: `getMainIsolateId`, `enableHttpProfiling`, `getNetworkActivity`.
  `connectDartMcpToApp` now enables HTTP profiling right after connecting —
  same "must be enabled before the fact happens" requirement as
  `get_runtime_errors` (007) — best-effort (`.catch(() => {})`), since this is
  enrichment evidence and must never break the connect flow for an app or SDK
  where it doesn't apply. `getNetworkActivity` is similarly best-effort
  (returns `""` on failure) rather than throwing.
- `reproduction.ts`: `RunResult` gained `networkActivity`; captured on every
  run, same place `nativeLog`/`runtimeErrors` already are.
- `session.ts`: `observe()` gained `networkActivity` in its return value.
- `examples/killer_demo_app/lib/task_api.dart`: changed from an in-memory
  fake to a **real** HTTP round trip — the app spins up its own tiny
  `HttpServer` on loopback (random port, first use) and calls it via a real
  `HttpClient` GET. This is a permanent change, not reverted: it makes the
  app's existing bug (fetched tasks never assigned to state) genuinely
  exercise the network evidence path too, self-contained — no external
  Python process, no `adb reverse`, works with a plain `flutter run`.

## Verified

Ran `investigate` live (through the real `mcp__flutter-medic__investigate`
tool, after a session restart picked up the new build) against the updated
`killer_demo_app`: reproduces 3/3 exactly as before (`expected-element-missing`,
zero regression), and every run's `networkActivity` now carries a real,
complete HTTP profile — `GET http://127.0.0.1:<port>/tasks`, full request/
response headers, connection timing, `statusCode: 200` — for all three runs,
including across the `hot_restart` between attempts (a fresh isolate re-binds
the loopback server and profiling gets re-enabled each time via
`connectDartMcpToApp`'s enable step, exactly as designed). This is the
spec's own original worked example, live and confirmed: the API succeeded
with real data, but the widget never rendered it.

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/mcp-clients.ts` | Added `getMainIsolateId`, `enableHttpProfiling`, `getNetworkActivity`; `connectDartMcpToApp` now enables profiling (best-effort) |
| `packages/orchestrator/src/reproduction.ts` | `RunResult.networkActivity`, captured in `runOnce` |
| `packages/orchestrator/src/session.ts` | `observe()` returns `networkActivity` |
| `examples/killer_demo_app/lib/task_api.dart` | Real self-contained HTTP round trip, replacing the in-memory fake |

## Status

Builds clean, live-verified end to end through the real MCP tool.
