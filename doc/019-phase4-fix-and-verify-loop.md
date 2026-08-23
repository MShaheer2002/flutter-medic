# 019 — Phase 4: fix & verify loop

**Date:** 2026-08-23
**Branch:** phase-1-mvp

Phase 4 (§13): "coding-agent handoff, hot-reload-and-reverify cycle."

## Coding-agent handoff — already satisfied, nothing built

The existing `investigate`/`reproduce` output (evidence + `report`, 017) is
already directly consumable by any coding agent, including the one driving
flutter-medic itself — that's the whole architecture (Phase 2's granular
tools + Phase 3's report). No new code needed for this half of Phase 4.

## Hot-reload-and-reverify cycle — new `verify_fix` tool

After a coding agent edits the app's source to fix a bug, `verify_fix`
re-checks the same tier-1 rules and returns `fixed: true`/`false`.

**Two reload modes, and this was only discovered by actually testing it
against a real fix, not reasoned out in advance**: the first live test
applied a correct fix to `killer_demo_app`'s real bug (assigning fetched
tasks to `_tasks`, which they never were), called `verify_fix` with
`hot_reload`, and got `fixed: false` — the tasks still didn't show. The fix
was right; `hot_reload` preserves widget state but doesn't re-trigger
lifecycle methods, and `_loadTasks()` (called from `initState`) had already
run once *before* the fix existed. Reloading the code doesn't make an
already-finished function call happen again.

Fix: `verify_fix` takes an optional `reloadMode: "hot_reload" | "hot_restart"`
(default `hot_reload`) and `steps`. `hot_restart` resets all state and
replays `steps` (reusing `reproduction.ts`'s `runInteractionSteps`, exported
for this rather than duplicated) — for bugs inside one-shot init logic,
that's the only way to make the fixed code actually execute. `hot_reload`
stays the default since it's faster and preserves navigation for bugs in
code that's re-evaluated every build (most UI logic).

## Confirms doc/016's finding applies beyond `reproduce()`

Retesting with `reloadMode: "hot_restart"` hit the exact same
post-`hot_restart` evidence-staleness issue documented in 016 — even after
adding `waitForStableUi` (the same best-effort poll `reproduce()` uses) to
`verify_fix`'s evidence read. Confirmed via a follow-up `observe()` moments
later that the fix was genuinely correct (`tasks_list` present, all 5 real
tasks). This cross-confirms 016's conclusion: the stale reading is a stable
state, not a transient race, so polling longer doesn't help — and now two
independent code paths (`reproduce()` and `verify_fix`) hit it identically,
reinforcing that it's a structural issue (likely in how Marionette or the
Flutter engine handles `hot_restart`), not something specific to one call
site.

## Verified

Live, end to end, against `killer_demo_app`: applied the real fix, confirmed
`hot_reload` correctly reports `fixed: false` for a one-shot-init bug (right
answer, explains why), confirmed `hot_restart` + step-replay reaches the
fixed code (via a follow-up `observe()`, since the immediate read hit the
016 staleness issue), reverted the fix afterward so the demo app stays
intentionally broken for other tests.

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/reproduction.ts` | Exported `runInteractionSteps` and `waitForStableUi` (previously private) |
| `packages/orchestrator/src/session.ts` | New `verifyFix(expectedElementKey?, reloadMode?, steps?)` |
| `packages/orchestrator/src/index.ts` | Registered `verify_fix` tool |
