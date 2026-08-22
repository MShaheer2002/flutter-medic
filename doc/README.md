# Dev log

One `.md` per unit of work, in order. Each entry: what was done, why it was needed, which files changed and why, and how it fits the bigger picture. Read newest-first if you just want current state; read in order for the reasoning trail.

| # | Entry | State when done |
|---|---|---|
| 001 | [Repo bootstrap](./001-repo-bootstrap.md) | Repo exists, README explains the product, GitHub connected, `main`/`dev` split |
| 002 | [npm workspaces monorepo scaffold](./002-monorepo-scaffold.md) | Toolchain proven end-to-end (`npm install → build → run`); zero product logic written yet |
| 003 | [Phase 0 findings](./003-phase-0-findings.md) | Dart MCP, Marionette, and Patrol all driven against a real device; core interaction loop confirmed, Patrol reliability issue found and partially diagnosed |
| 004 | [Spec corrections](./004-spec-corrections.md) | Living appendix correcting §5/§11 of the original spec against Phase 0 evidence — the `.docx` itself isn't edited or tracked in git |
| 005 | [Killer demo app](./005-killer-demo-app.md) | The spec's own acceptance test app built and verified on a real device — bug reproduces exactly as designed, confirmed silent (no crash, no exception) |
| 006 | [Orchestrator proof-of-loop](./006-orchestrator-proof-of-loop.md) | First real orchestrator code — hardcoded §6 flow runs end to end on a real device, reproduces 3/3, emits a structured evidence report; then wired up as an actual MCP tool and verified working through a real `mcp__flutter-medic__investigate` call |
| 007 | [Generalized anomaly detection](./007-generalized-anomaly-detection.md) | `investigate` is now parameterized (any app, any steps, any expected element) instead of hardcoded to one app's one bug; two real Node bugs found and fixed along the way; one real tool limitation root-caused and documented, not fixed |
| 008 | [Device auto-detection](./008-device-auto-detection.md) | `deviceId` is now optional — auto-detects the single connected physical Android device, errors clearly on zero or multiple matches |
| 009 | [Logcat backstop](./009-logcat-backstop.md) | Third tier-1 rule (`native-log-exception`) closes the gap from 007 — verified it catches exactly the error class the VM-service rule structurally can't, via the same injected-exception technique |
| 010 | [Granular MCP tools, Phase 2 started](./010-granular-mcp-tools-phase2-start.md) | Five new tools (`launch_app`, `close_app`, `tap`, `enter_text`, `observe`, `hot_restart`) let a calling AI agent explore and plan step by step, session state held across calls; one real cleanup bug found and fixed (`close_app` wasn't actually stopping the app on-device) |
| 011 | [Decouple CLI from example app](./011-decouple-cli-from-example-app.md) | The CLI's hardcoded killer-demo defaults (steps, expected element) moved into `examples/killer_demo_app/investigation.json` — the tool's source now has zero opinions about what app or bug it's pointed at |
| 012 | [Second demo app; live NL investigation setup](./012-second-demo-app-and-live-nl-investigation.md) (in progress) | `examples/crash_demo_app` built — a real, synchronous build-crash, deliberately different bug shape from `killer_demo_app`. Blocked on a session restart to actually run the live, tool-by-tool NL-driven investigation proving Phase 2's architecture |

## Where things stand right now

**Phase 1 is complete** (orchestration server, tool routing, device detection, launch/interact/observe, console log capture — all built and verified against a real device; see 003–009). **Phase 2 has started**, with the architecture decision made explicitly: natural-language planning lives in the *calling AI agent*, not embedded as a second LLM inside the orchestrator (rationale in 010) — matching how this whole project's development has actually worked all along (a human-directed AI agent driving granular tools by hand).

The orchestrator now exposes two distinct modes: `investigate` (self-contained — give it exact steps and an expected element, it reproduces 3x and reports against three tier-1 rules) and five granular tools — `launch_app`, `tap`, `enter_text`, `observe`, `hot_restart`, `close_app` — that hold session state across calls so a calling agent can explore a screen, decide what it means, and pick the next action itself. `observe` deliberately returns raw evidence with no anomaly rules applied — that judgment is the calling agent's job now, not the orchestrator's.

**Confirmed in Phase 0**: OBSERVE → ACT → OBSERVE works via Marionette on two different physical devices. MCP server scope (`local` vs `project`) matters for onboarding UX. Patrol MCP does not work reliably in this environment — root cause not found despite an exhaustive investigation (003/004) — not a blocker; the core loop needs only Marionette + Dart MCP.

**Next up (not yet decided)**: actually exercise the granular tools through a real NL-goal-driven Claude Code session (not just direct Node calls) to prove the Phase 2 architecture end to end from the calling-agent side, tier-2/3 anomaly detection, `flutter-medic init` (§14), or stress-test generality against a second, different demo app.
