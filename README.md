# flutter-medic

**Turn a running Flutter app into something an AI coding agent can autonomously test, debug, and fix — evidence first, guesses never.**

Instead of writing:
```
Tap login → enter email → enter password → tap submit → assert dashboard.
```
you tell your AI agent:
```
Make sure users can log in and reach a fully loaded dashboard. If something's wrong, find it.
```

flutter-medic is an MCP orchestration layer that sits between your AI coding agent (Claude Code, Cursor, etc.) and the existing free/open-source Flutter tooling (Dart MCP, Marionette MCP, Patrol MCP). It plans the investigation, drives the app on a real device, correlates UI state with logs and network traffic, reproduces failures multiple times to rule out flakiness, and hands back a structured, evidence-backed diagnosis — not a guess.

## Status

**Pre-implementation.** This repo currently contains the product spec only. Phase 0 (tooling research + validation) has not started. See [`Flutter_AI_QA_Agent_Product_Spec.docx`](./Flutter_AI_QA_Agent_Product_Spec.docx) for the full spec.

## Why

Flutter developers have `integration_test`, Patrol, DevTools, crash reporting, and AI coding assistants — but nothing that closes the loop from "something is broken" to "here is proof of what's wrong and why." AI agents can already edit code; they have no reliable, evidence-based way to see what a running mobile app is actually doing.

## How it works

flutter-medic doesn't rebuild the interaction layer — it builds the reasoning, evidence, and reproduction layer on top of tools that already do that well:

| Layer | Role |
|---|---|
| **Dart MCP** (official) | Project context, VM service / DTD connection, hot reload |
| **Marionette MCP** | Tap, type, scroll, screenshot, widget tree inspection |
| **Patrol MCP** | Native OS interaction, formal E2E sessions |
| **flutter-medic (this project)** | Session state across an investigation, log capture & correlation, reproduction logic, evidence bundling, root-cause correlation, fix-and-verify loop |

The orchestrator is simultaneously an MCP server (to your AI client) and an MCP client (to the three tools above), and decides tool routing itself rather than exposing every underlying tool to the model — keeping the visible tool surface small and avoiding conflicts between Marionette's and Patrol's app-process bindings.

## Core principles

- **Evidence over claims** — never "I think this is a bug," always "observed X, expected Y, reproduced N times, here is the evidence."
- **Reproduction before reporting** — a single failed run isn't a bug report; a threshold of consistent, repeated failures is.
- **Correlate, don't guess** — widget tree, network, logs, and navigation history are combined into one root-cause hypothesis, not reported as disconnected facts.
- **Verify the fix, not just the claim** — after a coding agent edits code, the same reproduction steps re-run to confirm the fix actually holds.

## MVP scope

Deliberately narrow, to prove the core loop before expanding:

- Android only, physical device over USB
- Local-only, no cloud account required
- Claude Code as the reference AI client
- Detect device → build → install → launch → observe → interact → capture logs → run a natural-language investigation → produce a structured, reproduction-backed report

**Killer demo:** a deliberately broken sample app (Login → Home → Tasks) where the API returns tasks but the widget doesn't render them. The developer says *"find why the tasks aren't showing after login"* — flutter-medic reproduces the anomaly, correlates it against a healthy API response, and returns an evidence-backed report.

## Roadmap

| Phase | Focus |
|---|---|
| 0 | Research — validate Dart MCP / Marionette / Patrol MCP APIs and compatibility |
| 1 | Android MVP — orchestration server, tool routing, device lifecycle, log capture |
| 2 | Agentic investigation — natural-language goals, autonomous navigation, reproduction logic |
| 3 | Evidence & root cause — network/log correlation, temporary instrumentation, structured reports |
| 4 | Fix & verify loop — coding-agent handoff, hot-reload-and-reverify |
| 5 | iOS support |
| 6 | CI integration — headless runs, automated PR comments |
| 7 | Optional backend correlation |

## Security & privacy

- Local-first — everything runs on your machine by default, no cloud account required.
- The agent bridge is never included in production builds unless explicitly enabled via a build flag.
- Passwords, tokens, and API keys are never automatically exposed to the AI model unless explicitly allowed.
- No screenshots or logs are uploaded anywhere by default.

## License

TBD.
