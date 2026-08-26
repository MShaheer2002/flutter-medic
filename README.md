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

**Built and live-verified end to end**, on both Android and iOS — confirmed working against real devices and simulators, not just unit-tested. See [`doc/`](./doc) for the full build log, every decision, and every live-verification result. **Published on npm** — see [Installing](#installing).

## What it can actually do

- **Run and drive the app itself** — launch on a real device, simulator, or emulator; navigate by tapping, typing, swiping, scrolling, pinch-zooming, long-pressing, going back — the same interactions a human tester would perform, driven autonomously from a plain-language goal.
- **Investigate on its own** — given a goal like *"log in and make sure the dashboard loads,"* it plans the steps itself, explores the app, and figures out what's broken without being told where to look first.
- **Gather real evidence, not guesses** — the actual widget tree, runtime exceptions, native device logs, and real network traffic (including full request/response bodies, not just status codes) — cross-referenced into one timeline.
- **Prove it's a real bug** — reproduces the failure multiple times before reporting anything, so a one-off flake never gets reported as a confirmed defect.
- **Hand off to a coding agent to fix it** — and then automatically re-run the same steps to confirm the fix actually worked, instead of just trusting the diff.
- **Dig deeper when the evidence isn't enough** — temporarily insert debug logging into the app's own source, rerun, read the result, then clean up automatically.
- **Cross-check independently** — hit an API endpoint directly, outside the app's own network stack, to tell apart "the backend is wrong" from "the app is calling it wrong."

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

From inside the Flutter project you want to investigate:

```sh
npx flutter-medic init
```

No cloning this repo, no manually picking the right registration command — `init` detects the project and which of Claude Code / Gemini CLI / Codex CLI / Cursor you have installed. Found just one? Registers automatically. Found more than one? Asks which to register with.

**One thing worth knowing**: Claude Code scopes the registration to the exact project directory `init` was run from — working across multiple Flutter apps means running `npx flutter-medic init` once in each one. Gemini CLI, Codex CLI, and Cursor register globally instead — once is enough, ever, for those three.

Then **restart your agent** — a newly registered MCP server's tools only appear after a fresh session starts (Cursor's the one exception; it picks up config changes live).

`init` also wires the app itself: installs the device bridge tooling, adds `flutter_medic_bridge` to `pubspec.yaml`, and patches `lib/main.dart` to initialize it — automatically, when it can recognize a plain `WidgetsFlutterBinding.ensureInitialized();` line to replace. If your `main.dart` doesn't match that shape, `init` tells you so and you wire it in by hand instead:

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter_medic_bridge/flutter_medic_bridge.dart';

void main() {
  if (kDebugMode) {
    FlutterMedicBridge.ensureInitialized();
  } else {
    WidgetsFlutterBinding.ensureInitialized();
  }
  runApp(const MyApp());
}
```

**Prerequisites, before `init` will find anything to investigate:**
- Flutter SDK, with Dart 3.9+ (ships `dart mcp-server` — flutter-medic spawns it internally, nothing to install separately)
- A physical Android device (USB debugging on) **or** a booted iOS Simulator **or** an Android emulator

From there, just ask your agent to investigate — e.g. *"Use flutter-medic to launch my app, log in, and find out why the tasks aren't showing on Home."*

**Building from source instead** (contributing, or testing a local change):
```sh
git clone https://github.com/MShaheer2002/flutter-medic.git
cd flutter-medic
npm install
npm run build --workspace=packages/orchestrator
claude mcp add flutter-medic -s local -- node "$(pwd)/packages/orchestrator/dist/index.js"
```

## Tool surface

One self-contained tool for a known investigation, plus a granular toolkit for open-ended exploration:

- **`investigate`** — give it steps + what you expect to see; it launches, reproduces 3x, and reports.
- **Session tools** — `launch_app`, `tap`, `enter_text`, `observe`, `reproduce`, `verify_fix`, `close_app`, plus the full gesture/keyboard set (`double_tap`, `long_press`, `swipe`, `pinch_zoom`, `scroll_to`, `press_back_button`, `press_key`), `hot_reload`/`hot_restart`, `take_screenshots`, `get_logs`.
- **Debugging aids** — `instrument_code`/`revert_instrumentation` (temporary debug logging, always reverted), `check_endpoint` (independent HTTP request, outside the app's own network stack).
- **`tap_native`** — taps a native OS element (permission prompt, system sign-in sheet) outside the Flutter widget tree entirely, by visible text/label. Android only for now, via `adb`/`uiautomator` — no target-app changes needed.

`observe`/`reproduce`/`investigate` all return raw evidence (widget tree, runtime errors, native log, real network request/response bodies) plus a human-readable `report` — judgment is left to the calling agent, not hardcoded.

## What's not built yet

- **`flutter-medic doctor`** — a setup-verification command (device connection, SDK versions, tool compatibility) before a session starts.
- **Native OS dialogs on iOS** — Android has `tap_native` (above). iOS needs [`idb`](https://github.com/facebook/idb), not yet wired in — Patrol (the tool built for this) was investigated and found unreliable in this environment; see `doc/003`/`doc/004`.
- **Headless CI usage** works today via the CLI directly, but wiring up an actual CI workflow is left to each project — not something this repo ships preconfigured.

## Security & privacy

- Local-first — everything runs on your machine by default, no cloud account required.
- The agent bridge is never included in production builds unless explicitly enabled via a build flag.
- Passwords, tokens, and API keys are never automatically exposed to the AI model unless explicitly allowed.
- No screenshots or logs are uploaded anywhere by default.

## License

MIT — see [LICENSE](./LICENSE).
