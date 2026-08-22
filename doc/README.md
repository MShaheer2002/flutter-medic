# Dev log

One `.md` per unit of work, in order. Each entry: what was done, why it was needed, which files changed and why, and how it fits the bigger picture. Read newest-first if you just want current state; read in order for the reasoning trail.

| # | Entry | State when done |
|---|---|---|
| 001 | [Repo bootstrap](./001-repo-bootstrap.md) | Repo exists, README explains the product, GitHub connected, `main`/`dev` split |
| 002 | [npm workspaces monorepo scaffold](./002-monorepo-scaffold.md) | Toolchain proven end-to-end (`npm install → build → run`); zero product logic written yet |
| 003 | [Phase 0 findings](./003-phase-0-findings.md) | Dart MCP, Marionette, and Patrol all driven against a real device; core interaction loop confirmed, Patrol reliability issue found and partially diagnosed |
| 004 | [Spec corrections](./004-spec-corrections.md) | Living appendix correcting §5/§11 of the original spec against Phase 0 evidence — the `.docx` itself isn't edited or tracked in git |
| 005 | [Killer demo app](./005-killer-demo-app.md) | The spec's own acceptance test app built and verified on a real device — bug reproduces exactly as designed, confirmed silent (no crash, no exception) |

## Where things stand right now

Phase 0 is complete (thoroughly, not hastily — see 003/004). Phase 1 has started: `examples/killer_demo_app` exists and is verified working — Login → Home → Tasks, a fake API call succeeds but the widget silently never shows the result. Confirmed via Marionette (drove the flow) and Dart MCP (`get_runtime_errors` clean, proving it's a silent bug, not a crash).

**Confirmed in Phase 0**: the core OBSERVE → ACT → OBSERVE loop works end to end via Marionette on two different physical devices. MCP server scope (`local` vs `project`) matters for onboarding UX. Patrol MCP does not work reliably in this environment — root cause not found despite an exhaustive investigation (see 003) — but it's not a blocker; the killer demo needs only Marionette + Dart MCP.

**Next up**: hardcode the §6 investigation flow (connect → login → observe the anomaly → reproduce N times → report) through the real orchestrator (`packages/orchestrator`) against this app — no NL planning yet, no LLM judgment, just the mechanical pipeline working end to end on a real bug.
