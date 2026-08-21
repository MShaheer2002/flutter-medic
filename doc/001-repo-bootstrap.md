# 001 — Repo bootstrap

**Date:** 2026-08-22
**Branch:** main

## What was done

Initialized the git repo, wrote the README, excluded the raw product spec from version control, connected the GitHub remote, and split off a `dev` branch for active work.

## Why needed

Nothing else can happen without a repo. The README exists because the spec is a 20KB `.docx` — not something a collaborator (or an AI agent picking this project up cold) should have to open and parse just to understand what's being built. The README is the git-tracked, diffable source of truth for product intent; the `.docx` is the original working document, kept around but out of version control since binary office docs don't diff meaningfully.

`main`/`dev` split: `main` stays the stable snapshot, `dev` is where actual work happens until there's something worth merging back.

## Files created / modified

| File | Action | Why |
|---|---|---|
| `README.md` | created | Public-facing explanation of the product vision, MCP aggregator architecture, core principles (evidence over claims, reproduction before reporting), MVP scope, roadmap, and security posture — condensed from the spec |
| `.gitignore` | created | Excludes `Product-Doc/` (the binary spec, not meant to be tracked) and `.DS_Store` (macOS noise) |
| *(remote)* | configured | `origin` set to `github.com/MShaheer2002/flutter-medic.git`; `main` pushed and tracked |

## Mental model

This is the "explain the product before touching any code" step. Everything downstream — architecture decisions, the tech stack, the scaffold — refers back to what's written here, because this is the first artifact anyone (human or agent) will read when they land in this repo.
