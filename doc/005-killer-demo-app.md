# 005 — Killer demo app built and verified

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done

Built `examples/killer_demo_app` — the spec's own acceptance test (§12.1): Login → Home → Tasks, where a fake API call succeeds and returns data, but the widget silently never renders it. Verified end to end on a real device via Marionette (typed credentials, tapped login, navigated to Home) and confirmed via Dart MCP that the failure is a genuinely silent one — `get_runtime_errors` returns clean, no exception anywhere.

## Why needed

This is the actual acceptance test for the whole product, named explicitly in the spec: *"If this works reliably, the core loop is proven."* Everything from here — the orchestrator's investigation logic, the tier-1 anomaly rules drafted earlier in this project's history, the reproduction threshold — needs a real, concrete target to be built and tested against, not an abstract flow. This is that target.

The bug is deliberately the hardest realistic case, not the easiest one: no crash, no exception, no error log — `_loadTasks()` awaits the fake API successfully, then calls `setState()` without actually assigning the fetched data to `_tasks`. This is exactly the tier-1 anomaly pattern already designed for the orchestrator (network 200 + N items returned, but the widget shows fewer than N) — a network/log-only detection strategy would find nothing wrong here; only correlating the successful fetch against the empty widget state catches it.

## Files created

| File | Action | Why |
|---|---|---|
| `examples/killer_demo_app/` | created | New Flutter app, tracked in git (unlike Phase 0's throwaway `fixtures/`) — this is a permanent project artifact, not a scratch tool-validation fixture |
| `lib/task_api.dart` | created | Fake backend — always succeeds, returns 5 hardcoded tasks after a simulated delay. The bug is never here; this file is intentionally correct |
| `lib/login_screen.dart` | created | Email/password form with `ValueKey`s on every interactive element (`email_field`, `password_field`, `login_button`) — Marionette's docs recommend keys over text matching for reliability |
| `lib/home_screen.dart` | created | Contains the actual bug: `_loadTasks()` fetches tasks but never assigns them to `_tasks` before calling `setState()` |
| `lib/main.dart` | created | Routes (`/login`, `/home`), `MarionetteBinding.ensureInitialized()` wired in from the start — confirmed necessary in Phase 0 |
| `pubspec.yaml` | modified | Added `marionette_flutter` dependency |

## Verified on real device (Huawei BKK-LX2)

1. Connected Marionette, entered credentials, tapped Login — navigated to Home.
2. `get_interactive_elements` on Home shows `"Upcoming Tasks"` header alongside `"No tasks to show."` — the bug reproduces exactly as designed.
3. `get_runtime_errors` (Dart MCP) returns clean — confirming this is a silent state bug, not a crash. No exception anywhere in the flow.

## Mental model

This is the first piece of Phase 1 that's actually product-facing rather than tool-validation scaffolding. Next: hardcode the §6 investigation flow (connect → login → observe → detect the anomaly → reproduce N times → report) through the real orchestrator (`packages/orchestrator`), using exactly this app as the target — no NL planning yet, no LLM anomaly judgment, just proving the mechanical pipeline works end to end against a real bug on a real device.
