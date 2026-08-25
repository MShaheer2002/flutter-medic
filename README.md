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

flutter-medic is an MCP orchestration layer that sits between your AI coding agent (Claude Code, and — per its own MCP standard — any other MCP-compatible agent) and the existing free/open-source Flutter tooling (Dart MCP, Marionette MCP). It plans the investigation, drives the app on a real device or simulator, correlates UI state with logs and network traffic — including real response body content, not just status codes — reproduces failures multiple times to rule out flakiness, and hands back a structured, evidence-backed diagnosis. Pair it with a coding agent and it closes the loop further: apply a fix, then automatically re-verify it against the same running app.

## Status

**Built and live-verified end to end**, on both Android and iOS. All seven roadmap phases below are implemented and have been confirmed working against real devices/simulators, not just unit-tested — see [`doc/`](./doc) for the full build log, every decision, and every live-verification result. Not yet published as an installable package — see [Installing](#installing) for the setup that works today.

## Why

Flutter developers have `integration_test`, Patrol, DevTools, crash reporting, and AI coding assistants — but nothing that closes the loop from "something is broken" to "here is proof of what's wrong and why." AI agents can already edit code; they have no reliable, evidence-based way to see what a running mobile app is actually doing.

## How it works

flutter-medic doesn't rebuild the interaction layer — it builds the reasoning, evidence, and reproduction layer on top of tools that already do that well:

| Layer | Role |
|---|---|
| **Dart MCP** (official) | Project context, VM service / DTD connection, hot reload |
| **Marionette MCP** | Tap, type, scroll, screenshot, widget tree inspection |
| **flutter-medic (this project)** | Session state across an investigation, log capture & correlation, reproduction logic, evidence bundling, root-cause correlation, fix-and-verify loop |

The orchestrator is simultaneously an MCP server (to your AI client) and an MCP client (to Dart MCP and Marionette MCP, which it spawns itself). Your AI agent only ever sees `flutter-medic` in its own MCP config — the underlying tools are internal implementation detail, never registered separately.

## Core principles

- **Evidence over claims** — never "I think this is a bug," always "observed X, expected Y, reproduced N times, here is the evidence."
- **Reproduction before reporting** — a single failed run isn't a bug report; a threshold of consistent, repeated failures is.
- **Correlate, don't guess** — widget tree, network (including real response bodies), logs, and navigation history are combined into one root-cause hypothesis, not reported as disconnected facts.
- **Verify the fix, not just the claim** — after a coding agent edits code, the same reproduction steps re-run to confirm the fix actually holds.

## Installing

Not yet on npm, so for now: clone and build from source.

```sh
git clone https://github.com/MShaheer2002/flutter-medic.git
cd flutter-medic
npm install
npm run build --workspace=packages/orchestrator
```

**Prerequisites:**
- Flutter SDK, with Dart 3.9+ (ships `dart mcp-server` — flutter-medic spawns it internally, nothing to install separately)
- Marionette MCP: `dart pub global activate marionette_mcp`
- A physical Android device (USB debugging on) **or** a booted iOS Simulator **or** an Android emulator
- The Flutter app you want to investigate needs [`marionette_flutter`](https://pub.dev/packages/marionette_flutter) wired into its own `main.dart`:
  ```dart
  import 'package:marionette_flutter/marionette_flutter.dart';

  void main() {
    if (kDebugMode) {
      MarionetteBinding.ensureInitialized();
    } else {
      WidgetsFlutterBinding.ensureInitialized();
    }
    runApp(const MyApp());
  }
  ```

**Register it with Claude Code:**

```sh
claude mcp add flutter-medic -- node /absolute/path/to/flutter-medic/packages/orchestrator/dist/index.js
```

Then **restart Claude Code** — a newly registered MCP server's tools only appear after a fresh session starts.

From there, just ask your agent to investigate — e.g. *"Use flutter-medic to launch my app, log in, and find out why the tasks aren't showing on Home."*

## Tool surface

One self-contained tool for a known investigation, plus a granular toolkit for open-ended exploration:

- **`investigate`** — give it steps + what you expect to see; it launches, reproduces 3x, and reports.
- **Session tools** — `launch_app`, `tap`, `enter_text`, `observe`, `reproduce`, `verify_fix`, `close_app`, plus the full gesture/keyboard set (`double_tap`, `long_press`, `swipe`, `pinch_zoom`, `scroll_to`, `press_back_button`, `press_key`), `hot_reload`/`hot_restart`, `take_screenshots`, `get_logs`.
- **Debugging aids** — `instrument_code`/`revert_instrumentation` (temporary debug logging, always reverted), `check_endpoint` (independent HTTP request, outside the app's own network stack).

`observe`/`reproduce`/`investigate` all return raw evidence (widget tree, runtime errors, native log, real network request/response bodies) plus a human-readable `report` — judgment is left to the calling agent, not hardcoded.

## Roadmap

All seven phases from the original spec are built and live-verified:

| Phase | Focus | Status |
|---|---|---|
| 0 | Research — validate Dart MCP / Marionette / Patrol MCP APIs and compatibility | ✅ |
| 1 | Android MVP — orchestration server, tool routing, device lifecycle, log capture | ✅ |
| 2 | Agentic investigation — natural-language goals, autonomous navigation, reproduction logic, tiered anomaly detection | ✅ |
| 3 | Evidence & root cause — network/log correlation, temporary instrumentation, structured reports | ✅ |
| 4 | Fix & verify loop — coding-agent handoff, hot-reload-and-reverify | ✅ |
| 5 | iOS support — Simulator, live-verified | ✅ |
| 6 | CI integration — headless-run capability (`--ci` exit codes); wiring an actual workflow is a per-project decision | ✅ |
| 7 | Network evidence completeness — real response bodies, independent endpoint verification (redefined from the original "backend log tailing" scope) | ✅ |

Not yet built: `flutter-medic init`/`doctor` (one-command setup, auto-registration across agents), and publishing to npm. Patrol MCP (native OS dialogs) was investigated and doesn't currently work reliably in this environment — see `doc/003`/`doc/004`.

## Security & privacy

- Local-first — everything runs on your machine by default, no cloud account required.
- The agent bridge is never included in production builds unless explicitly enabled via a build flag.
- Passwords, tokens, and API keys are never automatically exposed to the AI model unless explicitly allowed.
- No screenshots or logs are uploaded anywhere by default.

## License

MIT — see [LICENSE](./LICENSE).
