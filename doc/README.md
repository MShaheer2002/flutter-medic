# Dev log

One `.md` per unit of work, in order. Each entry: what was done, why it was needed, which files changed and why, and how it fits the bigger picture. Read newest-first if you just want current state; read in order for the reasoning trail.

| # | Entry | State when done |
|---|---|---|
| 001 | [Repo bootstrap](./001-repo-bootstrap.md) | Repo exists, README explains the product, GitHub connected, `main`/`dev` split |
| 002 | [npm workspaces monorepo scaffold](./002-monorepo-scaffold.md) | Toolchain proven end-to-end (`npm install → build → run`); zero product logic written yet |
| 003 | [Phase 0 findings](./003-phase-0-findings.md) | Dart MCP, Marionette, and Patrol all driven against a real device; core interaction loop confirmed, Patrol reliability issue found and partially diagnosed |
| 004 | [Spec corrections](./004-spec-corrections.md) | Living appendix correcting §5/§11 of the original spec against Phase 0 evidence — the `.docx` itself isn't edited or tracked in git |
| 005 | [Killer demo app](./005-killer-demo-app.md) | The spec's own acceptance test app built and verified on a real device — bug reproduces exactly as designed, confirmed silent (no crash, no exception) |
| 006 | [Orchestrator proof-of-loop](./006-orchestrator-proof-of-loop.md) | First real orchestrator code — hardcoded §6 flow runs end to end on a real device, reproduces 3/3, emits a structured evidence report |

## Where things stand right now

The core mechanical loop is proven, through real code, not manual tool calls. `packages/orchestrator/src/investigate.ts` spawns the killer-demo app, connects Marionette as an MCP client, logs in, observes, detects the known anomaly, reproduces it 3 times with a hot restart between attempts, and emits a structured JSON evidence report — verdict `"confirmed"`, reproduced 3/3, on a real device, zero manual intervention.

**Confirmed in Phase 0**: OBSERVE → ACT → OBSERVE works via Marionette on two different physical devices. MCP server scope (`local` vs `project`) matters for onboarding UX. Patrol MCP does not work reliably in this environment — root cause not found despite an exhaustive investigation (003/004) — not a blocker; the core loop needs only Marionette + Dart MCP.

**What's still hardcoded, deliberately**: the anomaly check in `investigate.ts` looks for this one app's specific known bug signature, not a general rule. There's no NL goal parsing and no LLM judgment yet. `task_api.dart` is an in-memory fake, not a real network call, so there's no real network-correlation signal to check yet either.

**Next up (not yet decided)**: generalize the anomaly detection toward the tier-1/2/3 system drafted early in this project, or wire `investigate.ts`'s flow up as an actual MCP *server* tool Claude Code can call directly, instead of a standalone script.
