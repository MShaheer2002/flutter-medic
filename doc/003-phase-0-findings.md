# 003 — Phase 0 findings (in progress)

**Date:** 2026-08-22
**Branch:** phase-0-research

Live findings from driving Dart MCP directly through Claude Code against `fixtures/scratch_app` on a physical device (Samsung SM-A125F, Android 12). Updated as Phase 0 progresses.

## MCP server registration scope — important for `flutter-medic init` (§14)

Registering `dart-mcp`/`marionette` via `claude mcp add -s project` (writes to the shared, git-committed `.mcp.json`) forces a human approval gate on next session start — Claude Code treats project-scoped config as untrusted-by-default, since anyone with repo write access could plant a malicious server in a committed file. Hit this twice during Phase 0 and had to restart/approve each time.

**Verified fix**: registering the exact same servers at `-s local` (writes to `~/.claude.json`, the developer's own machine, not the repo) connects immediately — no restart, no approval prompt. `flutter-medic init` must register Dart MCP/Marionette/Patrol at `local` (or `user`) scope, never `project` scope, or every real end user will hit an unnecessary restart-and-approve step on first setup. This wasn't in the spec at all — pure Phase 0 discovery.

## Environment confirmed working

- Flutter 3.47.1 (fvm global), Dart 3.13.1, physical Android device over USB — all functional together.
- `dart mcp-server` registered as a project-scoped MCP server (`.mcp.json`), connects cleanly once approved.
- `flutter run -d <device>` → real device install took ~23 min on first run (one-time Android NDK r28c + Build-Tools 36 download); should be fast on subsequent runs.

## Dart MCP — actual tool surface

Confirmed live (not the spec's paraphrase): `analyze_files`, `dtd`, `flutter_driver_command`, `get_runtime_errors`, `hot_reload`, `hot_restart`, `lsp`, `pub`, `pub_dev_search`, `read_package_uris`, `rip_grep_packages`, `roots`, `vm_service`, `widget_inspector`.

### `widget_inspector` — works out of the box
`get_widget_tree` (summaryOnly) returned a clean, accurate tree for the default counter app immediately after `dtd connect` — no app-side setup needed. Good sign for the orchestrator's evidence-collection needs.

### `get_runtime_errors` — works out of the box
Returned `"No runtime errors found."` cleanly against a healthy app. Not yet tested against an actual thrown exception — next step.

### `flutter_driver_command` — requires explicit app-side setup
Calling `get_health` failed:
> "The flutter driver extension is not enabled. You need to import `package:flutter_driver/driver_extension.dart` and then add a call to `enableFlutterDriverExtension();` before calling `runApp`... recommended to create a separate entrypoint file like `driver_main.dart`."

**This matters**: Dart MCP itself can drive tap/type/scroll (it's not exclusively Marionette's job, contrary to how the spec frames §5's tool routing table), but only if the app already has a driver-extension entry point wired in. Nothing works here for free — this is exactly the kind of setup `flutter-medic init` (§14) needs to automate, and it's evidence toward answering "what does a project need for automation to work" (Phase 0 goal #4).

## Marionette MCP — package family confirmed (pub.dev, not yet installed/tested)

| Package | Version | Role |
|---|---|---|
| `marionette_flutter` | 0.6.0 | App-side extension — tap/scroll/type/screenshot |
| `marionette_mcp` | 0.6.0 | The MCP server itself |
| `marionette_cli` | 0.6.0 | CLI variant |
| `marionette_logging` | 0.6.0 | Log collector adapter for the `logging` package |
| `marionette_logger` | 0.6.0 | Log collector adapter for the `logger` package |

Publisher: `leancode.co`, Apache-2.0 — matches the spec's attribution exactly. The two log-adapter packages are a direct answer to the spec's §11 "log capture is not uniform" concern — Marionette apparently already ships first-party bridges for two of the non-`print`/`debugPrint` logging paths, which is better coverage than the spec assumed we'd have to build ourselves.

Not yet installed against the scratch app — that's the next step, to find out what `marionette_flutter` actually requires in `main.dart` (compare against Dart MCP's driver-extension requirement above) and whether tap/type/screenshot work without the same setup friction.

## Marionette MCP — confirmed working against the scratch app

Setup actually required, per Marionette's own README (matches spec §11's "custom design systems need config" caveat, but standard Material widgets need none of that):
1. `flutter pub add marionette_flutter`
2. In `main.dart`: `MarionetteBinding.ensureInitialized()` in debug mode instead of `WidgetsFlutterBinding.ensureInitialized()` — replaces it, doesn't add alongside.
3. `dart pub global activate marionette_mcp`, register as an MCP server, connect via the app's VM service URI.
4. **A hot reload is not enough after adding the binding — needed a full hot restart**, since binding init only runs once in `main()`. Worth flagging for `flutter-medic init`: any one-time app-side setup change needs to trigger a restart, not a reload.

### The core OBSERVE → ACT → OBSERVE loop works, end to end, on the real device
- `get_interactive_elements` returned the FloatingActionButton, both Text widgets, with bounds/style/tooltip — richer per-element detail than Dart MCP's `widget_inspector` tree, but scoped to interactive/visible elements rather than the full hierarchy. The two tools are complementary, not redundant.
- `tap(type: "FloatingActionButton")` succeeded, and re-querying `get_interactive_elements` showed the counter text go from `"0"` → `"1"` — confirmed, not assumed. **This is the single most load-bearing assumption in the whole spec (the entire §6 worked example depends on this loop existing), and it's now verified against a real device, not just read about.**

### `get_logs` failed — `"Server error"`
Not yet root-caused. Marionette's docs describe log collection as requiring one of the `marionette_logging`/`marionette_logger` adapter packages wired to a `LogCollector` — plausible this needs that setup and doesn't work against bare `print()`/`debugPrint()` output without it. Next step: read the "Log Collection" guide and wire up an adapter, then retest.

## Open questions for the rest of Phase 0

- Does Marionette's tap/type/scroll avoid the driver-extension setup requirement, or does it hit the same friction?
- What does `get_runtime_errors` actually return for a real thrown exception (not yet tested)?
- Is the single-binding constraint (Marionette vs. Patrol) real, and what does violating it actually look like?
- What does Marionette's `get_logs` return relative to Dart MCP's log/error tools — redundant, or complementary?
