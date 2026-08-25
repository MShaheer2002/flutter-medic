# 017 — Structured report generation (Phase 3 started)

**Date:** 2026-08-23
**Branch:** phase-1-mvp

## What was done

Phase 2 is complete (016). Asked what Phase 3 covers per the spec (§13):
network correlation, log correlation, temporary code instrumentation mode,
structured report generation. Network correlation was already pulled forward
into Phase 2's timeframe (015). Of the rest, structured report generation
was the obvious first pick: every piece of evidence it needs already flows
through `RunResult`/`ReproductionResult` — this is synthesis, not a new
capability, and it's immediately useful without any new judgment calls.

`investigate` and the granular `reproduce` tool now both return a `report`
field alongside the existing structured JSON: a markdown summary with the
verdict up top and a deduplicated findings list (each distinct signal,
labeled in plain English, with how many of the N runs it fired in) below —
instead of leaving whoever reads the result to re-derive "so what actually
happened" from a pile of per-run objects.

## Design choices

- **Not a new tool.** Added as a field on the existing `investigate`/`reproduce`
  output rather than a separate `generate_report` call — the data's already
  there the moment reproduction finishes, no reason to make it a second round
  trip.
- **Dedup by `rule:description`, not just `rule`.** Two runs can fail the same
  rule for different reasons (e.g. two different runtime exceptions both
  tagged `runtime-exception`) — deduping only by rule name would silently
  merge distinct findings into one count.
- **`session.ts`'s `reproduce` has no `goal`** (the granular tools are
  step-by-step, not goal-driven up front) — `generateReport` takes `goal` as
  optional and falls back to a generic heading rather than requiring every
  caller to have one.

## Verified

Self-checked directly against the compiled `dist/report.js`: confirmed
verdict with a consistent 3/3 signal, a flaky not-reproduced case with a
mixed signal, and the zero-signal case — all render correctly. Not yet
live-tested through the real MCP tool (needs a session restart).

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/report.ts` | New — `generateReport(result, goal?)` |
| `packages/orchestrator/src/investigate.ts` | `EvidenceReport` gained `report` |
| `packages/orchestrator/src/session.ts` | `reproduce()`'s return gained `report` |

## Status

Builds clean, logic self-checked. Live verification pending a session restart.
