# 011 — Decouple the CLI from the killer-demo app's specifics

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done

Found and fixed a real, if narrow, coupling: `investigate.ts`'s CLI entry point hardcoded the killer-demo app's exact steps (`email_field`/`password_field`/`login_button`) and expected element (`tasks_list`) as silent defaults — regardless of which `appPath` you actually pointed it at. The `runInvestigation()` function itself was always fully parameterized; only the CLI's convenience fallback wasn't. Pointing the CLI at a different app would have silently tried to tap widgets that app doesn't have, producing a meaningless result with no indication why.

## Why it matters

The whole point of entry 007's generalization work was "any app, any steps, any expected element" — but a hardcoded CLI default undermines that in practice, since it's the most visible, most-used entry point into the tool. An investigation config being baked into the tool's own source code is exactly the kind of thing that quietly narrows "general-purpose tool" back down to "demo for one specific app" without anyone deciding that on purpose.

## Files created / modified

| File | Action | Why |
|---|---|---|
| `packages/orchestrator/src/investigate.ts` | modified | CLI now requires `<app-path> <config.json> [device-id]` — `goal`/`steps`/`expectedElementKey` come entirely from the config file argument, never a default baked into the tool |
| `examples/killer_demo_app/investigation.json` | created | The killer-demo app's specific investigation config, now living with the example app it describes, not inside the generic tool's source |

## Verified

Audited the entire `packages/orchestrator/src/` tree for any other reference to killer-demo-specific strings (`email_field`, `password_field`, `login_button`, `tasks_list`, etc.) — none found anywhere else; `session.ts`, `mcp-clients.ts`, `anomaly-detection.ts`, `native-log.ts`, `index.ts` were all already fully parameterized. Reran the CLI with the new `<app-path> <config.json> [device-id]` signature against the killer-demo app — identical result to every prior run (reproduced 3/3, verdict `"confirmed"`), confirming this was purely a decoupling fix, not a behavior change.

## Mental model

This is a small fix, but it's the right kind of small fix to make explicitly rather than let slide: the tool's own source code should have zero opinions about what bug it's looking for or what app it's pointed at. Every example-specific detail now lives with the example, not the tool.
