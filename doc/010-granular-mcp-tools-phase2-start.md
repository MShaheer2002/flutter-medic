# 010 — Granular MCP tools, Phase 2 started

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done

Started Phase 2 with a design decision made explicitly, not by default: natural-language planning and autonomous navigation will live in the **calling AI agent** (Claude Code, or whoever's driving via MCP), not embedded as a second LLM loop inside the orchestrator itself. Concretely, that means the orchestrator needs to expose the same granular building blocks Claude has been using by hand all session — `tap`, `enter_text`, `observe`, `hot_restart` — as real MCP tools with session state that persists *across* calls, alongside the existing self-contained `investigate` tool.

## Why this design, not the alternative

The spec's literal wording (§5, §6) attributes planning to "the orchestrator." The alternative (embed an LLM call inside the Node process to do the planning) was considered and rejected: it would duplicate reasoning Claude Code already does natively via MCP tool-use, tie the product to a specific embedded LLM and its own API key/cost, and contradict the spec's own "works with any MCP-compatible AI client" positioning (§1 names Claude Code, Cursor, Codex, Gemini CLI as interchangeable). It's also not hypothetical — this whole project's development process has *been* Option B in practice: a human-directed AI agent (me) driving granular Marionette/Dart MCP tools by hand, reasoning about what to do between calls. Phase 2 formalizes that same pattern as the product's actual architecture instead of just how development happened to work.

## Files created / modified

| File | Action | Why |
|---|---|---|
| `packages/orchestrator/src/mcp-clients.ts` | created | Extracted shared MCP-client helpers (`launchApp`, `waitForVmServiceUri`, `connectStdioClient`, `connectDartMcpToApp`, `getRuntimeErrors`, `toolText`) out of `investigate.ts`, plus a new `forceStopApp` helper (see bug below) — needed so both `investigate` (self-contained, one call) and the new session module (stateful, many calls) can share the same primitives without duplicating them |
| `packages/orchestrator/src/session.ts` | created | Module-level session state (one active session at a time, matching the MVP's single-investigation scope) and the granular actions: `launchAppSession`, `closeApp`, `tap`, `enterText`, `observe`, `hotRestart`. Every action but `launchAppSession` throws a clear "call launch_app first" error if there's no active session; `closeApp` is a safe no-op if there's nothing to close |
| `packages/orchestrator/src/investigate.ts` | modified | Rewired to import the shared helpers from `mcp-clients.ts` instead of duplicating them; behavior unchanged (regression-tested, see below) |
| `packages/orchestrator/src/index.ts` | modified | Registers five new tools (`launch_app`, `close_app`, `tap`, `enter_text`, `observe`, `hot_restart`) alongside the existing `investigate`, each a thin wrapper over `session.ts` |

## `observe`'s design: raw evidence, no judgment

Deliberately returns widget tree text + VM-service runtime errors + native-log exceptions with **no anomaly rules applied** — unlike `investigate`, which runs the tier-1 rules internally. The whole point of the granular tools is that the calling agent does the judging; baking `investigate`'s rules into `observe` too would defeat that. `investigate` stays the "I already know what to check" tool; the granular tools are the "let me look and decide" toolkit.

## A real bug found and fixed: `close_app` didn't actually stop the app

First end-to-end test of the granular flow (launch → observe → enter_text ×2 → tap → observe → hot_restart → observe → close) worked perfectly for every step **except** cleanup — after `close_app`, the app was still running on the device (`adb shell ps -A` still showed the process). Killing the local `flutter run` wrapper process doesn't reliably stop the installed app on the device itself — same category of thing we've hit multiple times this session (Phase 0's orphaned `marionette_mcp`/`dart mcp-server` processes, the scratch-app cleanup steps throughout).

Fixed with a new `forceStopApp(deviceId, applicationId)` helper in `mcp-clients.ts` (`adb shell am force-stop`), called from `closeApp()` and also retrofitted into `runInvestigation` — the same leak existed there too, just less visible since `investigate` runs start-to-finish in one call. Verified: launch → close now reliably leaves zero processes on the device.

## Verified end to end

1. **Regression check**: `investigate` against the killer-demo app, unchanged after the `mcp-clients.ts` extraction — reproduced 3/3, verdict `"confirmed"`, identical to every prior run.
2. **Session guards, no device needed**: `tap`/`enter_text`/`observe`/`hot_restart` all correctly throw `"No active session. Call launch_app first."` when called before `launch_app`; `close_app` is a safe no-op.
3. **Full granular flow, real device**: `launch_app` → `observe` (correctly showed the login form's fields) → `enter_text` ×2 → `tap` → `observe` (correctly showed the Home screen *with the bug* — "Upcoming Tasks" header, "No tasks to show.", zero exceptions) → `hot_restart` (correctly reset back to the login screen) → `close_app` (now genuinely stops the app, confirmed via `adb`).

## Mental model

This is the actual start of Phase 2, not just a plan for it. The orchestrator now has two distinct modes matching two distinct use cases: `investigate` for "I know exactly what to check, just reproduce it and tell me," and the granular tools for open-ended exploration where an AI agent needs to look at a screen, decide what it means, and pick the next action — the reasoning loop this whole project has been running by hand all session, now available as the product's own architecture.
