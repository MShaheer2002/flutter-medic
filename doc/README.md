# Dev log

One `.md` per unit of work, in order. Each entry: what was done, why it was needed, which files changed and why, and how it fits the bigger picture. Read newest-first if you just want current state; read in order for the reasoning trail.

| # | Entry | State when done |
|---|---|---|
| 001 | [Repo bootstrap](./001-repo-bootstrap.md) | Repo exists, README explains the product, GitHub connected, `main`/`dev` split |
| 002 | [npm workspaces monorepo scaffold](./002-monorepo-scaffold.md) | Toolchain proven end-to-end (`npm install → build → run`); zero product logic written yet |

## Where things stand right now

Nothing that resembles the actual product exists yet — no tool routing, no session state, no reproduction/evidence logic. What exists is scaffolding: a repo a human or agent can understand from the README alone, and a Node/TS workspace proven to build and run before anything real gets written on top of it.

**Next up (not started):** Phase 0 — manually validate Dart MCP, Marionette MCP, and Patrol MCP against a throwaway Flutter app to confirm the architecture's assumptions still hold, before the orchestrator's real logic gets built on the scaffold from 002.
