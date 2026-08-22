# 008 — Device auto-detection

**Date:** 2026-08-22
**Branch:** phase-1-mvp

## What was done

Closed the last gap flagged when assessing Phase 1 completeness: `deviceId` was a required parameter, meaning the caller always had to already know which device to target. Made it optional — when omitted, `investigate` now auto-detects a physical Android device via `flutter devices --machine`.

## Why needed

§Roadmap's Phase 1 line names "device detection" explicitly as in-scope, and it was the one clearly-missing piece after everything else (launch, interact, observe, tool routing, the MCP server itself) was already done and verified. Unlike the interaction loop or the anomaly-detection gap, this was known, scoped, mechanical work — not a research risk.

## Files created / modified

| File | Action | Why |
|---|---|---|
| `packages/orchestrator/src/device-detection.ts` | created | `detectAndroidDevice()` — runs `flutter devices --machine`, filters to `targetPlatform.startsWith("android") && !emulator` (matching the MVP's "Android only, physical device" scope from §12), errors clearly on zero or multiple matches rather than guessing |
| `packages/orchestrator/src/investigate.ts` | modified | `deviceId` is now optional on `InvestigateParams`; `runInvestigation` calls `detectAndroidDevice()` when it's omitted. `EvidenceReport` now records `deviceId`/`deviceName` so the report shows which device was actually used, whether specified or auto-detected. CLI's argument order changed to `<app-path> [device-id]` to match the new optionality |
| `packages/orchestrator/src/index.ts` | modified | Tool schema: `deviceId` is `.optional()` now, description updated to say so |

## Design choice: error on ambiguity, don't guess

Zero devices → clear error telling the caller to connect one or pass `deviceId`. More than one → clear error listing every candidate's ID and name, telling the caller to disambiguate. Silently picking "the first one" when several physical devices are connected risks running an investigation against the wrong device with no indication anything went wrong — worse than a caller having to be explicit once.

## Verified

Ran with `deviceId` omitted against a connected Huawei device — auto-detected `BBPBB19112217380` / `BKK LX2` correctly, reproduced 3/3 exactly as every prior manual-device-ID run has. Report now includes `"deviceId": "BBPBB19112217380", "deviceName": "BKK LX2"`.

## Mental model

This closes the device-detection gap from Phase 1's roadmap line. What's left against the spec's own Phase 1 definition is the log-capture gap already root-caused in entry 007 (a real, understood, unfixed limitation) and natural-language goal parsing (explicitly Phase 2 territory, not attempted here). Everything else Phase 1 asks for is done and verified against a real device.
