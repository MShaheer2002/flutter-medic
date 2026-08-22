# Dev log

One `.md` per unit of work, in order. Each entry: what was done, why it was needed, which files changed and why, and how it fits the bigger picture. Read newest-first if you just want current state; read in order for the reasoning trail.

| # | Entry | State when done |
|---|---|---|
| 001 | [Repo bootstrap](./001-repo-bootstrap.md) | Repo exists, README explains the product, GitHub connected, `main`/`dev` split |
| 002 | [npm workspaces monorepo scaffold](./002-monorepo-scaffold.md) | Toolchain proven end-to-end (`npm install → build → run`); zero product logic written yet |
| 003 | [Phase 0 findings](./003-phase-0-findings.md) | Dart MCP, Marionette, and Patrol all driven against a real device; core interaction loop confirmed, Patrol reliability issue found and partially diagnosed |
| 004 | [Spec corrections](./004-spec-corrections.md) | Living appendix correcting §5/§11 of the original spec against Phase 0 evidence — the `.docx` itself isn't edited or tracked in git |

## Where things stand right now

Still no orchestrator product logic — no tool routing, no session state, no reproduction/evidence engine. Phase 0 is substantially underway: Dart MCP, Marionette, and Patrol are all registered and connected, driven against a scratch app on a real Android device (Samsung SM-A125F).

**Confirmed**: the core OBSERVE → ACT → OBSERVE loop works end to end via Marionette (tapped a counter, verified state changed) — this was the single biggest unknown in the whole product and it's now de-risked. MCP server scope (`local` vs `project`) matters for onboarding UX, confirmed and corrected once.

**Found and not yet resolved**: Patrol MCP's `run` is unreliable in this environment — fails fast with no app running, hangs indefinitely with one already attached (a live `flutter run`, no Marionette involved). This generalizes the spec's §11 single-binding constraint beyond just Marionette-vs-Patrol. Root cause not confirmed; see 003 for the full diagnostic trail and 004 for what this changes about the orchestrator's design.

**Next up if Patrol work resumes**: test whether `MarionetteBinding` in `main.dart` interferes with Patrol's own Android-level app launch (untested variable). Otherwise: the single-binding constraint test is done in spirit (broader than planned), and Phase 0's two biggest open items are Patrol's root cause and the runtime-error/log-capture paths that errored (`get_logs`, `get_runtime_errors` against a real exception).
