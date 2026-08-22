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

## Where things stand right now

The core mechanical loop is proven, through real code, callable as a real MCP tool. `mcp__flutter-medic__investigate` takes an app path, interaction steps, an optional expected-element key, and an optional device ID (auto-detected if omitted); it launches the app, drives the steps, checks three independent tier-1 rules (`expected-element-missing`, `runtime-exception`, `native-log-exception`), reproduces 3 times with a hot restart between attempts, and returns a structured evidence report. Verified end to end against the killer-demo app — real bug, injected exception, explicit device, auto-detected device — all matching expectations exactly.

**Confirmed in Phase 0**: OBSERVE → ACT → OBSERVE works via Marionette on two different physical devices. MCP server scope (`local` vs `project`) matters for onboarding UX. Patrol MCP does not work reliably in this environment — root cause not found despite an exhaustive investigation (003/004) — not a blocker; the core loop needs only Marionette + Dart MCP.

**Phase 1, checked against the spec's own definition (§Roadmap, §12)**: orchestration MCP server ✅, tool routing ✅, device detection ✅, launch/interact/observe ✅, console log capture ✅ (three independent rules, each rule's actual coverage boundary tested, not assumed). Natural-language goal parsing is explicitly not attempted — that's Phase 2. By this checklist, **Phase 1 is complete.**

**Next up (not yet decided)**: tier-2 (baseline diff) or tier-3 (handing raw evidence to an LLM for judgment) anomaly detection, start on `flutter-medic init` (§14), stress-test how general the current parameterization really is against a second, different demo app, or move toward Phase 2's natural-language goal parsing.
