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

This is the first `packages/orchestrator` code that does something real. Everything before this (`index.ts`'s stub, the toolchain-proof from entry 002) was preparation; this is the actual product's skeleton, working. Next: generalize this from "hardcoded for one known app" toward the real tool-routing/session-state architecture the spec describes — or, alternatively, wire this same flow up as an actual MCP *server* tool (`investigate`) that Claude Code itself can call, rather than a standalone script — that's the next real architectural decision, not yet made.
