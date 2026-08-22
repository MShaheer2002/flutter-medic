# 004 — Spec corrections from Phase 0 (living notes)

**Date:** 2026-08-22
**Branch:** phase-0-research

This is a corrections appendix to `Product-Doc/Flutter_AI_QA_Agent_Product_Spec.docx`, not a replacement for it. The `.docx` isn't tracked in git and isn't hand-edited from here — this file records where Phase 0's real-device findings (`003-phase-0-findings.md`) contradict or refine specific claims in the original spec, so the correction is git-tracked and traceable to evidence, even though the source document itself isn't.

## Correction 1 — §5's tool routing table is wrong about Patrol

**Spec claim**: Patrol MCP is routed to "only when native OS interaction or a formal, reproducible test session is required" — implying it's a peer interaction backend to Marionette, just for a different interaction category.

**What Phase 0 found**: Patrol's tools (`run`, `devices`, `quit`, `status`, `screenshot`, `native-tree`) are file/session-oriented, not live-interaction-oriented. There's no `tap`/`enter_text`/`scroll` equivalent — `run` executes a written test file and blocks until completion. Patrol doesn't attach to an already-running app and puppeteer it step by step.

**Implication for the orchestrator design**: the orchestrator can't "route a tap to Patrol" the way it routes one to Marionette. It must instead **generate ephemeral Patrol test files programmatically** whenever native-OS capability is needed mid-investigation — write a throwaway `.dart` file, call `run`, parse the result, delete the file, all invisible to the developer. This is a distinct subsystem (codegen + file lifecycle + result parsing), not a branch in the same tap-routing logic used for Marionette/Dart MCP. Scope this as its own piece of Phase 1/2 work, not an extension of the router.

## Correction 2 — §11's single-binding constraint is broader than stated

**Spec claim**: "Marionette and Patrol's native test binding cannot drive the same app process at the same time" — framed as specifically a Marionette-vs-Patrol conflict.

**What Phase 0 found**: tested directly. With **no** app running, Patrol's `run` fails almost instantly (~2s) against nothing. With a plain `flutter run` session already attached — **no Marionette involved at all** — `run` hangs indefinitely (5+ min, zero diagnostic output, target process never touched). Patrol needs to fully own the device/app lifecycle itself, and doesn't degrade gracefully either way.

**Implication**: the constraint isn't "don't run Marionette and Patrol together" — it's "Patrol needs exclusive ownership of the app process, full stop, regardless of what else might be attached (a live `flutter run`, Marionette's DTD connection, anything)." The orchestrator must actively verify and tear down any other attached session immediately before any Patrol call, not just avoid a specific Marionette conflict. It also needs a **hard timeout + retry/abort policy** around Patrol calls specifically, since the failure mode observed was an indefinite hang with no diagnostic signal — not a clean error the orchestrator could otherwise catch and interpret.

## Confirmation — §6's core loop is no longer a hypothesis

Section 6's entire worked example depends on OBSERVE → ACT → OBSERVE actually working end to end on a real device. This is now verified, not assumed: tapped a `FloatingActionButton` via Marionette on the physical SM-A125F and confirmed via re-query that the counter state changed. This was the single most load-bearing unknown in the product — it's de-risked.

## Minor corrections worth carrying forward

- **Dart MCP can also drive taps** via `flutter_driver_command` — the spec's routing table implies interaction is Marionette's job alone. In practice Dart MCP has its own path too, but it requires `enableFlutterDriverExtension()` wired into a separate entry point first — nothing works without setup either way. This is a real product decision still open: standardize on Marionette only, or support both paths in `flutter-medic init`.
- **Log adapter coverage is better than the spec assumed** for two of the three non-stdout log paths — `marionette_logging`/`marionette_logger` are existing first-party adapters (§11 implied this would need to be built). Not fully banked yet, though: Marionette's own `get_logs` errored in testing (`"Server error"`), root cause not found.

## Not yet corrected / still open

- Patrol's actual crash root cause — still unexplained after the most exhaustive investigation in this project so far. Ruled out, one by one: version mismatch, stale session state, an external live session, `MarionetteBinding` interference, a matching KGP build-warning issue (`#3238`, confirmed cosmetic by its own reporter), an on-device install-confirmation prompt (`#2891`'s cause — watched the physical screen directly, nothing appeared), the `patrol_mcp` wrapper specifically (fails identically via raw `patrol_cli`), the device/OEM entirely (identical failure on a Samsung and a Huawei — different manufacturer, different Android version), and a Flutter version downgrade (3.35.7 changed the *symptom* — no more crash message, longer execution window — but still zero tests ever ran, and the app never appears in device logs on either version). Every reasonably-cheap diagnostic avenue has been exhausted. **This is now a closed investigation, not an open mystery to keep poking at** — well-documented, thoroughly evidenced, genuinely unresolved. Not a blocker for Phase 1 — the killer demo needs only Marionette + Dart MCP, both confirmed working; Patrol is only needed later for native-OS-dialog handling.
- If Patrol needs to be made reliable eventually, the remaining live options: (1) file a new issue against `leancodepl/patrol` with this entire investigation's findings — none of their existing issues match, and this is more diagnostic depth than what's currently in their tracker, (2) build native interaction directly via `UiAutomator`/`XCUITest` if Patrol can't be salvaged at all, (3) degrade gracefully — detect "blocked, cause unknown" and report it as a manual step rather than trying to fully automate past it.
