# 002 — npm workspaces monorepo scaffold

**Date:** 2026-08-22
**Branch:** dev

## What was done

Set up the repo as an npm workspaces monorepo, created the `orchestrator` package with the official MCP SDK as a dependency, added a TypeScript build, and wrote a placeholder entry point that constructs an `McpServer` instance — then actually ran `npm install → npm run build → node dist/index.js` to confirm the whole chain works, not just that the files exist. Added an MIT license.

## Why needed

The spec (§10) names the tech stack — TypeScript/Node orchestrator, Dart companion package later — but three things it left open had to be decided before any file could be created: package manager, monorepo tooling, and the MCP SDK version. Decided: npm, npm's native `workspaces` field (no Turborepo/Nx/Lerna — nothing here is big enough to justify that dependency yet), and `@modelcontextprotocol/sdk` (the official one).

The entry point is deliberately empty of product logic. Before writing tool routing, session state, or the evidence engine (Phase 1+), the toolchain itself needs to be proven — does the workspace resolve, does the SDK import cleanly, does the compiled output run. Catching a broken import or a deprecated API here, in a 5-line stub, is cheap. Catching it after 500 lines of orchestrator logic is not. (This is also how the deprecated `Server` class got caught and swapped for `McpServer` — `tsc` flagged it immediately against the stub, before it could get baked into real code.)

## Files created / modified

| File | Action | Why |
|---|---|---|
| `package.json` (root) | created | Declares `workspaces: ["packages/*"]` — npm's built-in monorepo mechanism |
| `packages/orchestrator/package.json` | created | Orchestrator's own manifest: `@modelcontextprotocol/sdk` as the runtime dependency, `typescript` + `@types/node` as dev deps, `build`/`dev` scripts wrapping `tsc` |
| `packages/orchestrator/tsconfig.json` | created | Strict TS config, `ES2022`/`NodeNext` module resolution — matches Node's native ESM support |
| `packages/orchestrator/src/index.ts` | created | Placeholder entry point; constructs an `McpServer` with zero tools registered — proves the SDK wires up, nothing more. Tool routing, session state, and the evidence/reproduction engine are not here yet |
| `LICENSE` | created | MIT — spec positions the product as open source (§9/§14); MIT is the permissive default consistent with the tools it depends on |
| `.gitignore` | modified | Added `node_modules/` and `dist/` now that a Node toolchain exists to produce them |
| `README.md` | modified | License section: `TBD` → points at `LICENSE` |

## Mental model

This is the "prove the plumbing" step, not the "build the product" step. Nothing here is meant to survive contact with real product logic unchanged — `index.ts` will be rewritten from scratch once Phase 0 validation (see roadmap) confirms the underlying tools (Dart MCP, Marionette MCP, Patrol MCP) behave the way the spec assumes. The point of doing it now, ahead of that, is that a broken *toolchain* and a broken *architecture assumption* are two different failure modes — better to rule out the first before spending effort investigating the second.

**Next:** Phase 0 — manually drive Dart MCP + Marionette MCP against a throwaway Flutter app to confirm the spec's technical assumptions (single-binding rule, log stream access) before any real orchestrator logic gets written on top of this scaffold.
