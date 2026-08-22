# 014 — Expose the rest of Marionette's gesture/system/inspection tools

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done

The user asked for a full accounting of touch/gesture/sensor coverage, then asked for all of it to be exposed. Read Marionette's actual source (`~/.pub-cache/hosted/pub.dev/marionette_mcp-0.6.0/lib/src/vm_service/tools/`) rather than relying on memory of the tool list, to get exact schemas — found and exposed 10 more granular tools, on top of the 7 already built (010, 013):

| New tool | Category | What it does |
|---|---|---|
| `double_tap` | gesture | Double tap (`delay` param, default 100ms) |
| `long_press` | gesture | Hold (`duration` param, default 600ms) |
| `secondary_tap` | gesture | Right-click, desktop only |
| `swipe` | gesture | Element+direction, or exact coordinate-based drag |
| `pinch_zoom` | gesture | `scale` required, >1 zooms in |
| `scroll_to` | gesture | Scrolls until a key/text match is visible |
| `press_back_button` | system | Android back / iOS swipe-back |
| `press_key` | keyboard | Real key events through focus (enter, tab, escape, arrows, modifiers) |
| `take_screenshots` | inspection | Base64 PNGs of every view |
| `get_logs` | inspection | Marionette's own log collector (needs an app-side adapter — see below) |
| `hot_reload` | system | Reload code, preserve state (we only had `hot_restart` before) |

## Confirmed, not guessed: no sensor simulation exists anywhere

Searched the entire Marionette source tree (`marionette_mcp` and `marionette_flutter`) for `sensor`, `accelerometer`, `gyroscope`, `gps`, `location`, `orientation`, `battery` — zero matches. There is no device-sensor simulation capability in Marionette at all, and nothing in Dart MCP or Patrol covers it either based on what's been explored of them so far. If a future investigation needs GPS- or accelerometer-dependent behavior, none of the current tooling can drive it — a real, confirmed gap, not a "probably not supported."

## Design choices

- **`tap`/`enter_text` left untouched.** They're proven (verified across dozens of runs this session) and used by `reproduction.ts`'s `InvestigationStep` type. Every new tool is additive, not a modification of what already works.
- **New `ElementMatcher` type** (`key`/`text`/`type`/`coordinates`) matches Marionette's own targeting model exactly — every new gesture tool accepts the same four alternatives Marionette itself supports, not just `key` like our original `tap` does.
- **`get_logs` deliberately not merged into `observe()`.** It's a genuinely different evidence source (Marionette's own `LogCollector`, requiring a `marionette_logging`/`marionette_logger` adapter wired into the target app — see Phase 0's `003-phase-0-findings.md`) from what `observe()` already returns (VM-service runtime errors + native logcat). Exposed separately so its distinct setup requirement and failure mode stay visible rather than silently folded into evidence that already works out of the box.

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/session.ts` | Added `ElementMatcher` interface and 10 new exported functions, all thin wrappers over the corresponding Marionette tool call |
| `packages/orchestrator/src/index.ts` | Registered all 10 as MCP tools with schemas matching Marionette's own exactly (read from source, not guessed) |

## Status

Builds clean. Live verification blocked on a session restart (new tool registrations — same pattern every tool addition has hit: 006, 010, 012, 013).
