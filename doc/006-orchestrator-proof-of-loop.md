# 006 — Orchestrator proof-of-loop

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done

Wrote `packages/orchestrator/src/investigate.ts` — the first real orchestrator code, not a stub. Hardcoded implementation of the spec's §6 investigation flow: launch the killer-demo app, connect Marionette as an MCP client, log in, observe, detect the known anomaly, reproduce 3x, produce a structured evidence report. Ran it end to end on a real device (Huawei BKK-LX2) with zero manual intervention. Result: reproduced 3/3, verdict `"confirmed"`.

## Why needed

This is the actual mechanical proof the whole project has been building toward. Phase 0 confirmed the individual pieces work (Marionette can tap, Dart MCP can inspect); this is the first time they're driven by *our own code* acting as an MCP client, not by manual tool calls typed one at a time. It's deliberately hardcoded — no NL goal parsing, no LLM anomaly judgment — because the goal right now is proving the pipeline's mechanics work, not building the reasoning layer on top of an unproven foundation.

## Files created / modified

| File | Action | Why |
|---|---|---|
| `packages/orchestrator/src/investigate.ts` | created | The actual flow: spawn `flutter run`, parse the VM service URI from its output, connect an MCP `Client` to `marionette_mcp` via `StdioClientTransport`, drive login, detect the anomaly, reproduce 3x with a `hot_restart` between attempts, emit a structured report |
| `packages/orchestrator/package.json` | modified | Added an `investigate` script |
| `packages/orchestrator/tsconfig.json` | modified | Added `"types": ["node"]` — needed for `node:child_process`/`node:os`/`node:path` and global `Buffer`/`process` to resolve; the stub `index.ts` never needed Node built-ins, this is the first file that does |

## What the anomaly detection actually does (and doesn't do) here

Hardcoded, not general: it checks specifically for `empty_tasks_message` present and `tasks_list` absent in Marionette's `get_interactive_elements` output — this is *this app's* known bug signature, not the tier-1 rule engine drafted earlier in this project (network response correlation, etc.). That's deliberate — proving the mechanical pipeline came first. Generalizing this into the actual tier-1/2/3 anomaly system, and wiring in real network correlation (there's no real HTTP call here, `task_api.dart` is an in-memory fake), is explicitly future work, not skipped by oversight.

## Mental model

This is the first `packages/orchestrator` code that does something real. Everything before this (`index.ts`'s stub, the toolchain-proof from entry 002) was preparation; this is the actual product's skeleton, working.

## Update: wired up as a real MCP tool, verified

`index.ts` now registers `investigate` as an actual `McpServer` tool (device ID as input, zod schema) and serves over stdio, instead of just constructing an unused server object. `investigate.ts`'s core logic was refactored into a reusable exported function, with the CLI entry point kept as a thin wrapper.

Registered locally as the `flutter-medic` MCP server and — after the expected session restart for a brand-new server (per the Phase 0 finding: local scope skips the approval prompt, but a restart is still needed for a genuinely new server) — called `mcp__flutter-medic__investigate` directly, the same way any other MCP tool gets called. Result: identical to the CLI run — reproduced 3/3, verdict `"confirmed"`.

This proves the actual product architecture, not just the mechanics: `flutter-medic` is now a real peer MCP server next to Dart MCP, Marionette, and Patrol — callable by any MCP-compatible AI client, not just triggerable by hand from a terminal. The remaining gap is capability breadth, not plumbing: the detection logic is still hardcoded to this one app's one known bug signature. Generalizing it toward the tier-1/2/3 anomaly system is the next real piece of work.
