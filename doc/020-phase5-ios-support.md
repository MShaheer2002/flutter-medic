# 020 — Phase 5: iOS support (untested — built blind, by explicit user choice)

**Date:** 2026-08-23
**Branch:** phase-1-mvp

**This entire feature has not been run against a real iOS device or
simulator.** The user has no iOS device available right now and explicitly
chose to have this built without live testing, to be verified later — even
though Xcode + iOS Simulator turned out to be available on this Mac and
could have been used for real verification today (offered, declined). What
follows is real code, backed by what partial self-checks were possible
without a device, but the actual `xcrun simctl`/`log show` command usage
against a running simulator is unverified. Treat this as a draft to
pressure-test, not a finished feature.

## What was built

Spec (§13): "Simulator first, physical device later." Scoped accordingly —
iOS Simulator is supported; a physical iOS device gets a clear
"not implemented yet" error for native-log capture and force-stop rather
than a guessed implementation using tooling (libimobiledevice, or unverified
`xcrun devicectl` log-streaming syntax) that might silently misbehave.

- **`device-detection.ts`**: `detectAndroidDevice()` → `resolveDevice(deviceId?)`,
  returning `{id, name, platform: "android"|"ios", isSimulator}`. Two real
  behavior changes, both deliberate: (1) an explicitly-given `deviceId` now
  always resolves its platform via `flutter devices --machine` instead of
  being assumed Android — previously, passing `deviceId` skipped detection
  entirely, so the explicit-id path silently assumed Android even if it
  wasn't; (2) auto-detect's candidate pool now includes iOS devices and
  simulators alongside physical Android, so a mixed environment (phone +
  booted simulator) correctly errors "multiple devices found" instead of
  picking one silently.
- **`ios-support.ts`** (new): `getIosBundleId` (parses `project.pbxproj`'s
  `PRODUCT_BUNDLE_IDENTIFIER` — `Info.plist`'s own value is normally the
  unresolved variable `$(PRODUCT_BUNDLE_IDENTIFIER)`, not a real bundle id),
  `captureIosLogMarker`/`readIosLogSince` (via `xcrun simctl spawn <udid>
  log show --start <marker> --predicate 'process == "Runner"'` — "Runner" is
  Flutter's default iOS target name, same class of assumption as
  native-log.ts's hardcoded "flutter" logcat tag), `forceStopIosApp` (via
  `xcrun simctl terminate`). All four throw a clear error for a physical
  device rather than attempting an unverified physical-device code path.
- **`platform-support.ts`** (new): thin dispatcher — `getApplicationId`,
  `captureLogMarker`, `readNativeLogSince`, `forceStopApp` — so
  `investigate.ts`/`session.ts`/`reproduction.ts` call one platform-aware
  function each instead of repeating `platform === "ios" ? x : y` at every
  call site. `platform`/`isSimulator` now thread through `RunResult`'s
  producing functions (`reproduce`/`runOnce` in `reproduction.ts`) and
  `session.ts`'s `Session` state, `investigate.ts`'s `runInvestigation`.

## What could actually be verified without a device, and was

- `getIosBundleId` against `killer_demo_app`'s real, generated
  `ios/Runner.xcodeproj/project.pbxproj`: correctly resolved
  `com.flutterMedic.examples.killerDemoApp` — a real dotted identifier, not
  the unresolved `$(PRODUCT_BUNDLE_IDENTIFIER)` variable. This is genuine
  verification of the parsing logic against a real file, just not against a
  running process.
- `captureIosLogMarker`'s output format matches what `log show --start`
  expects (`YYYY-MM-DD HH:MM:SS`).
- **Regression check on the refactor itself** (this mattered more than the
  iOS pieces): `resolveDevice()` run live against this machine's actual
  `flutter devices --machine` output (Android phone connected, macOS desktop
  + Chrome also present, no iOS device/simulator booted) — confirmed it
  still correctly picks the Android device as the sole candidate, doesn't
  get confused by the desktop/web entries, and the explicit-`deviceId` path
  resolves to an identical result. Then re-ran `investigate` against
  `killer_demo_app` through the real MCP tool end to end (see Verified below)
  to confirm the whole refactored plumbing — `device-detection.ts` →
  `platform-support.ts` → `native-log.ts`/`mcp-clients.ts` — didn't regress
  the Android path every existing doc (003 through 019) depends on.

## Not verified at all

- `xcrun simctl spawn <udid> log show ...`'s exact output format and
  whether the `process == "Runner"` predicate is right — never run against
  a booted simulator.
- `xcrun simctl terminate` actually stopping a launched app.
- Whether `flutter run -d <simulator-udid>` and the existing VM-service
  connection logic (`waitForVmServiceUri`, `connectDartMcpToApp`) work
  unchanged against a simulator target — they're already platform-agnostic
  in principle (Marionette/Dart MCP talk to the VM service, not adb), but
  "should work in principle" is exactly the kind of claim this project's
  own practice (003, 007, 009, 016, 018, 019) has repeatedly shown needs
  checking, not trusting.

## Files modified

| File | Action |
|---|---|
| `packages/orchestrator/src/device-detection.ts` | `detectAndroidDevice` → `resolveDevice`, platform-aware |
| `packages/orchestrator/src/ios-support.ts` | New — simulator-only iOS implementations |
| `packages/orchestrator/src/platform-support.ts` | New — platform dispatch layer |
| `packages/orchestrator/src/investigate.ts`, `session.ts`, `reproduction.ts` | Thread `platform`/`isSimulator` through instead of hardcoding Android |

## Status

Builds clean. Bundle-id parsing and log-marker formatting self-checked
against real files. Device-detection regression-checked live. **The iOS
Simulator path itself — `xcrun simctl` log capture and force-stop — is
unverified and should be treated as a draft until run against a real
simulator.**
