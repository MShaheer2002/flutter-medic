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
diff) — all passed. **Not yet live-verified against a real device/app** —
needs a session restart to pick up this build in the running MCP server
process, same as every previous change (006, 010, 012, 013, 014, 015).

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/anomaly-detection.ts` | Added `detectBaselineDrift` |
| `packages/orchestrator/src/baseline.ts` | New — `loadBaseline`/`saveBaseline` |
| `packages/orchestrator/src/reproduction.ts` | `runOnce` takes `appPath`, wires in the load/diff/save-first-run-wins flow |

## Status

Builds clean, logic self-checked. Live device verification pending a session restart.
