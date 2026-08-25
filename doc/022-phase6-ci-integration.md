# 022 — Phase 6: CI integration (capability only, no workflow added)

**Date:** 2026-08-24
**Branch:** phase-1-mvp

Scope agreed with the user: build the *capability* for headless CI usage
(§13: "headless runs on PRs, automated bug reports as PR comments"), but
don't wire up an actual `.github/workflows/*.yml` in this repo yet — that
would start running on real PRs, which needed a separate decision the user
wasn't ready to make.

## What was actually missing — smaller than expected

Investigated before building: does CI even need new emulator-detection code?
No. `resolveDevice(deviceId)`'s explicit-`deviceId` path (020) never filtered
by `emulator` — that filter only applies to auto-detect. A CI script always
knows the exact device it just booted and passes its id explicitly, so
Android emulators (and the iOS Simulator, already proven in 021) already
work today with zero code changes. Same for `adb`-based force-stop/log
capture — `adb` doesn't distinguish emulator from physical hardware.

**The one real gap**: the CLI's exit-code convention was backwards for CI.
`investigate.ts`'s CLI entry point (built in 006, never revisited) exits `0`
when a bug is `confirmed` — the right polarity for self-testing flutter-medic
itself ("did it correctly confirm the bug we know is there?"), but exactly
backwards for a CI gate on a real project, where a confirmed bug must *fail*
the check, not pass it.

## Fix

Added a `--ci` flag to the CLI. Without it, the original convention is
unchanged (confirmed → exit 0) — nothing that already depends on this CLI
breaks. With it, polarity flips (confirmed → exit 1), matching what an
actual CI gate needs. Two different questions ("did the tool work?" vs. "is
the app healthy?") sharing one exit code would have silently broken one of
them regardless of which way it was set — `--ci` exists so the caller states
which question it's asking instead of the tool guessing.

## Verified

Live, on the real device, both modes, against `killer_demo_app`'s known
confirmed bug:
- Without `--ci`: exit `0` (self-test convention, unchanged).
- With `--ci`: exit `1` (CI-gate polarity, new).

Both runs confirmed `"verdict": "confirmed"` in the actual output (not just
trusting the exit code), and the app was cleanly closed after each.

## What Phase 6 still needs, not built

- **Actual PR-comment posting** — deliberately out of scope for orchestrator
  code. Posting a comment is a thin CI-script concern (`gh pr comment
  --body-file`), not something that belongs in flutter-medic's TypeScript —
  the tool's job is producing the `report` (already done, 017), not knowing
  about GitHub's API.
- **A real CI workflow** — not added to this repo per the agreed scope.
  Whoever wires this up would: boot an emulator/simulator, run
  `node dist/investigate.js <app> <config> <device-id> --ci`, and on
  non-zero exit, post the JSON output's `report` field via `gh pr comment`.

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/investigate.ts` | CLI gained `--ci` flag, flips exit-code polarity |
