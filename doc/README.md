# Dev log

One `.md` per unit of work, in order. Each entry: what was done, why it was needed, which files changed and why, and how it fits the bigger picture. Read newest-first if you just want current state; read in order for the reasoning trail.

| # | Entry | State when done |
|---|---|---|
| 001 | [Repo bootstrap](./001-repo-bootstrap.md) | Repo exists, README explains the product, GitHub connected, `main`/`dev` split |
| 002 | [npm workspaces monorepo scaffold](./002-monorepo-scaffold.md) | Toolchain proven end-to-end (`npm install → build → run`); zero product logic written yet |
| 003 | [Phase 0 findings](./003-phase-0-findings.md) (in progress) | Dart MCP connected and driven against a real device; first concrete findings landing |

## Where things stand right now

Still no orchestrator product logic — no tool routing, no session state, no reproduction/evidence engine. What's new: Phase 0 is actually underway. Dart MCP is registered and connected in this Claude Code session, a scratch Flutter app is running on a real Android device, and we're calling Dart MCP's tools directly against it to find out what's actually true versus what the spec assumed.

**Next up:** install `marionette_flutter`/`marionette_mcp` against the scratch app and compare its setup friction and tool behavior against Dart MCP's `flutter_driver_command` (which needs explicit driver-extension wiring — see 003).
