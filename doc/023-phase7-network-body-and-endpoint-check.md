# 023 — Phase 7: response body content + independent endpoint check

**Date:** 2026-08-24
**Branch:** phase-1-mvp

The user rejected backend log tailing (§13's original Phase 7 scope) as too
invasive — it needs access to infrastructure that varies per project and
this tool has never needed to touch before. Redefined scope instead: make
sure the *client-visible* network evidence is actually complete (status,
body, endpoint — not just status), and add a way to independently verify an
endpoint's real behavior, used on demand rather than automatically.

## The real gap, confirmed before building

Checked `vm_service` package's own source rather than assuming:
`ext.dart.io.getHttpProfile` (already used since 015) only ever returns
request/response *metadata* — status, headers, timing. The actual body
content requires a separate, per-request call,
`ext.dart.io.getHttpProfileRequest`, which returns `requestBody`/
`responseBody` as raw byte arrays. So every `networkActivity` blob captured
since 015 has shown "the API returned 200" but never *what* it returned —
exactly the gap the user pointed at.

## What was built

- **`mcp-clients.ts`'s `getNetworkActivity`**: now fetches each completed
  request's full body via `getHttpProfileRequest` and merges
  `requestBodyText`/`responseBodyText` (UTF-8-decoded, capped at 10k chars)
  into the existing JSON structure — same field, same shape, just no longer
  missing the one thing "what did the API actually say" needs. Best-effort
  per request (a failed body fetch doesn't break the rest of the evidence).
- **New `check_endpoint` tool**: makes a real, independent HTTP request via
  Node's built-in `fetch` — no new dependency. Deliberately *not* wired into
  `observe()`/`reproduce()` automatically (the user's own framing: "where
  needed, not everywhere") — it's there for a calling agent to invoke when
  it specifically wants to know whether an endpoint's behavior is real or
  whether something app-side (headers, cookies, request shape) is the actual
  cause. No active `launch_app` session required, since it's independent of
  any running app.
- Endpoint/base-URL visibility needed no new work — the full request URI
  was already present in `networkActivity` and already surfaced per-line in
  the report's Timeline section (018).

## Verified

- `check_endpoint` self-checked against a real local HTTP server (not
  mocked) — default GET, explicit POST with a body, headers, and status all
  round-tripped correctly.
- Body-content enrichment: pending a live run against the real device (see
  below).

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/mcp-clients.ts` | `getNetworkActivity` enriches each request with decoded body content |
| `packages/orchestrator/src/network-check.ts` | New — `checkEndpoint` |
| `packages/orchestrator/src/index.ts` | Registered `check_endpoint` |
