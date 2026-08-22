# 016 — Tier 2: baseline-diff anomaly detection

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What tier 2 is, and why it's different from tier 1

Tier 1 (007/009) checks for something you named in advance — "is this key
missing," "did an exception fire." Tier 2 checks for *anything different*
from a previously known-good run of the same app + interaction steps,
without needing to name what to look for. Catches regressions tier 1 was
never told to watch for; costs more false positives on screens with
legitimately dynamic content (this project's demo apps don't have any, so
that risk isn't exercised yet).

## Design decision: baseline source

Asked the user directly rather than guessing: **saved to disk, first run
wins**. The first time `investigate`/`reproduce` runs a given app + exact
steps + expectedElementKey with zero tier-1 signals, that run's
`interactiveElements` text is banked as the baseline. Every later run with
the same identity diffs against it. Rejected alternative: calling agent
supplies the baseline explicitly — more flexible, but pushes "what counts as
known-good" onto every caller instead of just working out of the box.

## Implementation

- `baseline.ts` (new): `loadBaseline`/`saveBaseline`, keyed by a SHA-1 of
  `{appPath, steps, expectedElementKey}`. Stored in `~/.flutter-medic/baselines/`
  — deliberately outside the target app's own repo, since `appPath` can be any
  project on the user's machine and flutter-medic shouldn't write generated
  files into a repo it doesn't own.
- `anomaly-detection.ts`: `detectBaselineDrift(current, baseline)` — plain
  line-set diff (lines present in one but not the other), not fuzzy. Verified
  safe to be this strict: doc/015 showed three reproduction runs of the same
  steps producing byte-identical `interactiveElements` text, so exact-diff
  doesn't false-positive on run-to-run noise for these apps.
- `reproduction.ts`'s `runOnce`: after the existing tier-1 checks, loads the
  baseline for this run's identity. If one exists, diffs and adds a
  `baseline-drift` signal on mismatch. If none exists yet AND this run had
  zero other signals, saves this run as the new baseline — never banks a
  broken run as "known good."

## Verified

Pure logic self-checked directly against the compiled `dist/` output (key
isolation across different steps/expectedElementKey, save/load round-trip,
drift detection on added/removed lines, no false positive on an identical
diff) — all passed.

Live-tested against `killer_demo_app` through the real MCP tool: the rule
itself works exactly as designed — first run banks a baseline, later runs
correctly diff against it and correctly report no drift when nothing
changed. But the live test also surfaced a **real, separate bug** — see below.

## Known issue found during live testing: evidence can be stale right after `hot_restart`

Every run *after* a `hot_restart` (never the first, fresh-launch run) was
reporting `interactiveElements` as "2 GestureDetectors" instead of the real
Home screen content — triggering `baseline-drift` correctly (the evidence
genuinely differs from the baseline) but for the wrong reason: this isn't a
real app regression, it's `hot_restart`'s own evidence being unreliable.

Root-cause path, all dead ends until the last step:
1. **Assumed it was a settle-timing race** (querying before the route
   transition finished) — bumped the fixed post-interaction sleep from
   800ms to 1500ms. No change.
2. **Replaced the fixed sleep with poll-until-stable** (`waitForStableUi` in
   `reproduction.ts` — polls `get_interactive_elements` until two consecutive
   reads match, instead of guessing a constant). Also no change, and this
   result was informative: the poll proves the bad reading is **not**
   transient — it's genuinely stable, so it's not a mid-animation race at all.
3. **Checked the source of both screens** (`login_screen.dart`,
   `home_screen.dart`) to see whether "2 GestureDetectors" could legitimately
   belong to either. Home has zero `GestureDetector`-producing widgets in any
   of its three states (loading spinner / empty message / task list) — so
   this reading shouldn't be possible on Home at all.
4. **Took an actual screenshot** at the exact moment of the bad reading. It
   shows the AppBar title correctly says "Home" (so navigation genuinely
   happened), but the body underneath is completely blank — no spinner, no
   message, no list. That doesn't match any of `home_screen.dart`'s three
   legitimate render states either.

Conclusion: navigation to Home genuinely completes after `hot_restart`
(confirmed by both the AppBar title and, separately, `networkActivity`
showing the real `fetchTasks()` HTTP call firing every time), but something
about the body's render/paint or Marionette's semantics-tree read gets stuck
in an intermediate state that never resolves — not a timing race (waiting
longer, however long, doesn't help), something structurally different. This
affects **every** rule that reads `interactiveElements`, not just tier-2 —
tier-2 just happened to be the first rule sensitive enough to surface it,
since `expected-element-missing` alone can't distinguish "wrong screen" from
"right screen, bug reproduced" (both look like "key not found").

**Not fixed. Documented, not chased further** — this needs more focused
investigation (a hypothesis worth checking next: whether `hot_restart` leaves
Marionette's semantics-tree binding attached to something stale, or whether
Flutter's own ticker/animation state doesn't fully reset on hot restart) than
made sense to keep doing interactively. `waitForStableUi` is kept as a real
improvement over a blind fixed sleep regardless (correctly resolves genuine
transient races), it just doesn't cover this specific failure mode.

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/anomaly-detection.ts` | Added `detectBaselineDrift` |
| `packages/orchestrator/src/baseline.ts` | New — `loadBaseline`/`saveBaseline` |
| `packages/orchestrator/src/reproduction.ts` | `runOnce` takes `appPath`, wires in the load/diff/save-first-run-wins flow; fixed post-interaction sleep replaced with `waitForStableUi` (poll until two consecutive reads match) |

## Status

Builds clean, logic self-checked, tier-2 rule itself live-verified working
correctly. **Known open issue**: evidence capture can be unreliable
immediately after `hot_restart` — root cause not yet found, documented above
for whoever picks this up next.
