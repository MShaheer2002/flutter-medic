# 003 — Phase 0 findings (in progress)

**Date:** 2026-08-22
**Branch:** phase-0-research

Live findings from driving Dart MCP directly through Claude Code against `fixtures/scratch_app` on a physical device (Samsung SM-A125F, Android 12). Updated as Phase 0 progresses.

## MCP server registration scope — important for `flutter-medic init` (§14)

Registering `dart-mcp`/`marionette` via `claude mcp add -s project` (writes to the shared, git-committed `.mcp.json`) forces a human approval gate on next session start — Claude Code treats project-scoped config as untrusted-by-default, since anyone with repo write access could plant a malicious server in a committed file. Hit this twice during Phase 0 and had to restart/approve each time.

**Verified fix, with a correction**: registering the exact same servers at `-s local` (writes to `~/.claude.json`, the developer's own machine, not the repo) skips the approval *prompt* entirely — confirmed by re-adding `dart-mcp`/`marionette` at local scope with zero prompt. But that first test was re-scoping servers *already live-connected* in the session — it didn't prove a brand-new server becomes usable without a restart. Testing `patrol` (a genuinely new server, first time this session) showed the gap: `claude mcp list` reported it "Connected" immediately, but no `mcp__patrol__*` tools were usable in this session — because `claude mcp list` runs its own fresh probe process, separate from the live connection this session actually uses. The process itself is fine (confirmed by running `dart run patrol_mcp` directly — starts cleanly, no error).

**Corrected finding**: `local`/`user` scope removes the *approval prompt* (that part's still true and still matters for `flutter-medic init`), but a **session restart is still required the first time a new MCP server is added mid-session**, regardless of scope. That's a session-lifecycle constraint (deferred tools are enumerated at session start), not a trust/security gate. So `flutter-medic init`'s onboarding will still need one restart on first setup — just not a manual "approve this?" click, which is the meaningful UX improvement.

## Environment confirmed working

- Flutter 3.47.1 (fvm global), Dart 3.13.1, physical Android device over USB — all functional together.
- `dart mcp-server` registered as a project-scoped MCP server (`.mcp.json`), connects cleanly once approved.
- `flutter run -d <device>` → real device install took ~23 min on first run (one-time Android NDK r28c + Build-Tools 36 download); should be fast on subsequent runs.

## Dart MCP — actual tool surface

Confirmed live (not the spec's paraphrase): `analyze_files`, `dtd`, `flutter_driver_command`, `get_runtime_errors`, `hot_reload`, `hot_restart`, `lsp`, `pub`, `pub_dev_search`, `read_package_uris`, `rip_grep_packages`, `roots`, `vm_service`, `widget_inspector`.

### `widget_inspector` — works out of the box
`get_widget_tree` (summaryOnly) returned a clean, accurate tree for the default counter app immediately after `dtd connect` — no app-side setup needed. Good sign for the orchestrator's evidence-collection needs.

### `get_runtime_errors` — works out of the box
Returned `"No runtime errors found."` cleanly against a healthy app. Not yet tested against an actual thrown exception — next step.

### `flutter_driver_command` — requires explicit app-side setup
Calling `get_health` failed:
> "The flutter driver extension is not enabled. You need to import `package:flutter_driver/driver_extension.dart` and then add a call to `enableFlutterDriverExtension();` before calling `runApp`... recommended to create a separate entrypoint file like `driver_main.dart`."

**This matters**: Dart MCP itself can drive tap/type/scroll (it's not exclusively Marionette's job, contrary to how the spec frames §5's tool routing table), but only if the app already has a driver-extension entry point wired in. Nothing works here for free — this is exactly the kind of setup `flutter-medic init` (§14) needs to automate, and it's evidence toward answering "what does a project need for automation to work" (Phase 0 goal #4).

## Marionette MCP — package family confirmed (pub.dev, not yet installed/tested)

| Package | Version | Role |
|---|---|---|
| `marionette_flutter` | 0.6.0 | App-side extension — tap/scroll/type/screenshot |
| `marionette_mcp` | 0.6.0 | The MCP server itself |
| `marionette_cli` | 0.6.0 | CLI variant |
| `marionette_logging` | 0.6.0 | Log collector adapter for the `logging` package |
| `marionette_logger` | 0.6.0 | Log collector adapter for the `logger` package |

Publisher: `leancode.co`, Apache-2.0 — matches the spec's attribution exactly. The two log-adapter packages are a direct answer to the spec's §11 "log capture is not uniform" concern — Marionette apparently already ships first-party bridges for two of the non-`print`/`debugPrint` logging paths, which is better coverage than the spec assumed we'd have to build ourselves.

Not yet installed against the scratch app — that's the next step, to find out what `marionette_flutter` actually requires in `main.dart` (compare against Dart MCP's driver-extension requirement above) and whether tap/type/screenshot work without the same setup friction.

## Marionette MCP — confirmed working against the scratch app

Setup actually required, per Marionette's own README (matches spec §11's "custom design systems need config" caveat, but standard Material widgets need none of that):
1. `flutter pub add marionette_flutter`
2. In `main.dart`: `MarionetteBinding.ensureInitialized()` in debug mode instead of `WidgetsFlutterBinding.ensureInitialized()` — replaces it, doesn't add alongside.
3. `dart pub global activate marionette_mcp`, register as an MCP server, connect via the app's VM service URI.
4. **A hot reload is not enough after adding the binding — needed a full hot restart**, since binding init only runs once in `main()`. Worth flagging for `flutter-medic init`: any one-time app-side setup change needs to trigger a restart, not a reload.

### The core OBSERVE → ACT → OBSERVE loop works, end to end, on the real device
- `get_interactive_elements` returned the FloatingActionButton, both Text widgets, with bounds/style/tooltip — richer per-element detail than Dart MCP's `widget_inspector` tree, but scoped to interactive/visible elements rather than the full hierarchy. The two tools are complementary, not redundant.
- `tap(type: "FloatingActionButton")` succeeded, and re-querying `get_interactive_elements` showed the counter text go from `"0"` → `"1"` — confirmed, not assumed. **This is the single most load-bearing assumption in the whole spec (the entire §6 worked example depends on this loop existing), and it's now verified against a real device, not just read about.**

### `get_logs` failed — `"Server error"`
Not yet root-caused. Marionette's docs describe log collection as requiring one of the `marionette_logging`/`marionette_logger` adapter packages wired to a `LogCollector` — plausible this needs that setup and doesn't work against bare `print()`/`debugPrint()` output without it. Next step: read the "Log Collection" guide and wire up an adapter, then retest.

## Patrol MCP — structurally different from Marionette, not a native-OS variant of it

Registered `patrol_mcp` (v0.2.0, LeanCode, Apache-2.0 — matches spec attribution) against the scratch app. Key finding, from its own README, **before** even getting its tools working in-session:

**Patrol's tools are file/session-oriented, not live-interaction-oriented.** Its tool surface is `run` (execute a Patrol test *file* and block until completion), `devices`, `quit`, `status`, `screenshot`, `native-tree` — there is no `tap`/`enter_text`/`scroll` equivalent to Marionette's. Patrol doesn't attach to an already-running app and puppeteer it step by step; it launches its own "develop session" and runs a written integration-test file against it.

**This matters for the orchestrator's design** (§5's tool routing table implies Patrol is just Marionette-for-native-dialogs, a peer interaction backend): it isn't. To use Patrol for a native permission dialog mid-investigation, the orchestrator would need to *generate* a Patrol test file on the fly and invoke `run`, not call an interactive tap tool. That's a meaningfully different integration pattern than routing a tap call to Marionette vs. Dart MCP — worth designing for explicitly in Phase 1/2, not assuming symmetry with Marionette.

**Setup differs from Marionette too**: no `main.dart` binding change. Instead, `patrol_mcp` and `patrol_cli` come in as transitive dependencies of `patrol_mcp` itself (not separately version-tracked as the spec's §9 implied), and the server is launched via `dart run patrol_mcp` with `PROJECT_ROOT` pointing at the Flutter project — needs a shell wrapper (`sh -c "cd <project> && dart run patrol_mcp"`) since the command must execute with that project's `pubspec.yaml` as its working directory, not the monorepo root.

### `run` tested — build succeeds, test execution fails, root cause not yet found

Wrote a minimal test (`fixtures/scratch_app/patrol_test/counter_test.dart`, using `patrolTest`/`pumpWidgetAndSettle`/`$()` finders — API confirmed against the `patrol` package's own bundled examples, not guessed) and called `mcp__patrol__run`.

- Build succeeded: `Completed building apk with entrypoint patrol_test_bundle.dart (209.8s)`.
- Execution phase completed in 19.8s, but result was `testState: "finishedFailed"`, with: *"The app shut down before the test reported completion. This usually means the app crashed or exited early rather than a test assertion failing."*
- Checked `adb logcat` around the execution window for a crash trace — found the app force-stopped (`am force-stop`) but **no Flutter/AndroidRuntime exception or stack trace** in the surrounding log window. Root cause not yet identified.
- **Leading hypothesis, not yet confirmed**: Patrol's test bundle (`patrol_test_bundle.dart`) pumps `MyApp()` directly via `$.pumpWidgetAndSettle()` — it does not call our app's real `main()`, so `MarionetteBinding.ensureInitialized()` (wired into `main.dart` for the Marionette testing above) shouldn't be in the execution path at all. If that's right, this failure is unrelated to Marionette's binding and is either a real bug in my minimal test, or a genuine Patrol/device compatibility issue — still open.
- **Isolated further**: wrote a completely self-contained control test (no dependency on our app, no Marionette import — the package's own trivial `MaterialApp` example verbatim). Reran against a *warm* develop session (reusing the one from the first failed run) — same result, but much faster this time (5.9s build, 3.8s execute — "Hot Restart: logs connected" in the output), still `finishedFailed` with the identical "app shut down before test reported completion" message. **This rules out my test file/app code as the cause** — it's a Patrol/device/environment-level issue.
- **Second failure mode found**: after `quit`-ing that session and clearing the logcat buffer, rerunning the same control test against a *cold* session hung indefinitely — `status` returned `"testState": "running"`, `"output": "No output available"` for 5+ minutes, with **zero app process ever appearing on the device** (`adb shell ps -A` showed nothing). Had to force-stop via `quit`. This is a second, distinct problem: a cold `run` after `quit` doesn't reliably restart the build/install cycle, or hangs silently instead of failing visibly.
- **Conclusion for Phase 0**: Patrol MCP's `run` tool is unreliable in this environment in two distinct ways — (1) execution completes and reports a mysterious app-shutdown failure even for a trivial control case, and (2) a cold restart after `quit` can hang indefinitely with no diagnostic output at all. Root cause not found for either. This is a real, load-bearing risk for the product's native-OS-interaction story (§5's Patrol routing), not a one-off fluke — it reproduced twice, two different ways.

## Version compatibility check (patrol_mcp / patrol_cli / patrol)

Resolved versions: `patrol_mcp` 0.2.0, `patrol_cli` 4.7.0 (transitive, no separate global activation), `patrol` 4.9.0, `patrol_finders` 3.6.0. Checked against the compatibility table `patrol_mcp`'s own README points to (`patrol.leancode.co/documentation/other/patrol-mcp`) — that table only documents up to `patrol_mcp` 0.1.4+ → `patrol_cli ^4.3.0`; 0.2.0 has no explicit row, likely just undocumented rather than incompatible, since 4.7.0 still satisfies the `^4.3.0` range from the last documented entry.

**More useful finding, from `patrol_mcp`'s own CHANGELOG.md** (read directly from the package, not the docs site): 0.2.0 explicitly states *"`run` returns a failed run instead of hanging when the app exits before the test finishes (needs `patrol` 4.7.0+)"* — we have `patrol` 4.9.0, above that threshold. **This means our two failures above are not a version-mismatch bug**: `patrol_mcp` is correctly detecting and reporting a real underlying app crash (failure 1). Versions are compatible; the underlying crash cause is still open.

**Clean retest confirms the hang was self-inflicted, not a Patrol bug.** Reran the same control test with no logcat interference this time: completed cleanly and fast (3.4s build, 1.6s execute) — no hang. So clearing the logcat buffer mid-session earlier likely did interfere with `patrol_mcp`'s own progress tracking; that failure mode is not a real product risk.

**Stale-session hypothesis tested directly and ruled out.** Caught `mcp__patrol__status` reporting `"isDevelopRunning": true` while `adb shell ps -A` showed zero matching processes on the device — a real state desync, confirming Patrol's internal bookkeeping can drift from device reality. But after `quit` (confirmed via `status` → `"isDevelopRunning": false`, genuinely idle) and a fresh `run` from that clean state, **the identical failure reproduced**: ~2s build, `"Hot Restart: logs connected"` in the output, `finishedFailed` with the same "app shut down" message. Since this happened even from a verified-clean starting state, stale session state is not the (sole) cause.

**Root cause found: Patrol conflicts with an already-attached `flutter run` debug session — this explains both failure modes.**

Tested directly: launched the scratch app via a normal `flutter run -d <device>` first (confirmed live via `adb shell ps -A`, PID 9913), then called `mcp__patrol__run` against it.

- Result: **hung indefinitely** — `status` stuck at `"running"` / `"No output available"` for 5+ minutes (past the 5-minute timeout), and the original app process (PID 9913) never changed, meaning Patrol never even got as far as attempting an install.
- This is the mirror image of the earlier fast-fail case: with **no** app running at all, `run` fails almost instantly (~2s, "Hot Restart" against nothing, per the entries above). With an app **already running** via an external `flutter run` session, `run` hangs indefinitely instead, apparently unable to take over the device/app slot from the existing debug session.

**This is effectively the single-binding-style constraint the spec warns about (§11), just manifesting between Patrol and a plain `flutter run` session rather than between Patrol and Marionette specifically.** Only one debugging/instrumentation session appears able to own a given app process on a device at a time — Patrol needs to fully own the device/app lifecycle itself, and doesn't degrade gracefully (clear error) when something else is already attached; it either fails against nothing or hangs against something.

**Practical implication for the orchestrator**: before calling Patrol's `run`, the orchestrator must ensure no other tool (a live `flutter run`, Marionette's DTD connection, etc.) is currently attached to the target app — matching the spec's "orchestrator picks one execution mode per session; switches deliberately, not concurrently" mitigation, but now confirmed to extend to Patrol-vs-any-live-session, not just Patrol-vs-Marionette.

Stopping here for Phase 0's purposes — this is now a well-understood, reproducible constraint (not a mystery), documented well enough to design around in Phase 1/2 rather than something that needs solving today.

## Isolation test: `MarionetteBinding` ruled out as the cause

Tested the one remaining variable directly: temporarily stripped `MarionetteBinding.ensureInitialized()` out of `main.dart` entirely (reverted to a stock `runApp(const MyApp())`), **fully uninstalled** the app from the device (`adb uninstall`, not just killed), killed every other process (`pkill` the lingering `flutter run`), and confirmed `patrol status` was genuinely `idle` before running.

**Result: identical failure.** `finishedFailed`, same "app shut down before test reported completion" message, same `"Hot Restart"` line in the output, fast completion (10.5s build — longer than usual since it had to reinstall from scratch — 2.9s execute).

**This conclusively rules out Marionette's binding as the cause.** Every variable we could control from our side has now been eliminated: version compatibility (fine), Patrol's own session-state desync (fixed, retested clean), an external live session (removed), and `MarionetteBinding` (removed). The failure is not caused by anything in our project or setup — it's either a `patrol_mcp`/`patrol_cli` bug on this specific Android version/OEM (Samsung Galaxy A12, Android 12, One UI), or a deeper environment interaction not yet identified. `MarionetteBinding` restored to `main.dart` afterward (needed for the already-validated Marionette work).

**Given every controllable variable has been exhausted, this is where Phase 0's Patrol investigation stops for now.** Real next steps if this is revisited: try against a different physical device/Android version to see if it's OEM-specific, or file/search the `patrol` GitHub issues for this exact symptom on Samsung devices.

## GitHub issue research — one promising lead, tested and ruled out

Checked `patrol`'s own GitHub issues for this exact symptom. Confirmed we're on the latest versions of everything (`patrol` 4.9.0, `patrol_mcp` 0.2.0 — no newer release exists). Found and checked two close matches:

- **`#3238`** ("Patrol 4.9 still triggers Flutter 3.47 incompatible KGP warning") — matches our exact version combo (Patrol 4.9.0, patrol_cli 4.7.0, Flutter 3.47.0) but the reporter confirms it's cosmetic-only: a build warning, no test failures or crashes. Ruled out as our cause.
- **`#2891`** ("[Android] Unable to run `patrol test/develop` of `example` on Android 16 physical device", closed) — different Android version (16 vs. our 12) but a near-identical symptom ("App shut down on request", fast failure, no clear cause). Root cause there: Android shows an **on-device install confirmation prompt** (app APK + `androidx.test.orchestrator`), and if nobody taps "Install"/"Allow" on the physical screen, the install silently blocks and gets reported as "app shut down." Genuinely promising — matched our fast-failure, no-log-output pattern exactly, and Samsung's Knox layer is known to be stricter about this than stock Android.

**Tested directly, twice, with the user watching the physical device screen in real time for the entire run.** Result: **nothing appeared on screen at all** — no install prompt, no notification, no visible activity of any kind, both times. This rules out the install-confirmation-prompt theory as our cause. Whatever's failing is happening at a stage even earlier than reaching the device's UI layer — consistent with `patrol_cli` never actually attempting a real install at all, rather than attempting one and getting silently blocked.

**Status: root cause still not found**, after the most thorough investigation reasonably justified for a Phase 0 side-investigation — version compatibility, session state, external processes, app code (`MarionetteBinding`), and now the two most relevant known GitHub issues, all checked and ruled out. Stopping here for real. This is a well-documented, reproducible, unresolved bug — not a mystery we haven't tried to solve.

## Bypassing `patrol_mcp` entirely — bug is deeper than the MCP wrapper

Globally activated `patrol_cli` (`dart pub global activate patrol_cli`, version 4.7.0 — same version the MCP server itself uses) and ran `patrol test --target patrol_test/control_test.dart --device R58NC4SX99E` directly, with no `patrol_mcp` layer involved at all.

- **Result: exit code 0, but "Total: 0" tests** — zero tests were ever discovered/executed by the native Android test runner, despite the generated `patrol_test/test_bundle.dart` correctly including our test (confirmed by reading the generated file — `group('control_test', control_test.main)` is present and correct).
- This rules out `patrol_mcp` (the MCP wrapper, only 0.2.0, weeks old) as the source of the bug — the same underlying dysfunction happens driving `patrol_cli` directly. Whatever's wrong is in the native instrumentation layer shared by both, not in the MCP server's own session-tracking code.

## Samsung Knox / security-agent interference — most concrete lead yet, not fully confirmed

Checked `adb logcat` around this direct `patrol_cli` run's timestamp and found a dense burst of package-lifecycle events: `PACKAGE_FULLY_REMOVED` broadcasts, Samsung's Knox License Manager (`ENTM:KLMIntentService`) and Enterprise agent (`ENTM:Systemprocess`) reacting to the install/uninstall, an `SPPClientService` package-remove handler, and Google Play Protect (`Finsky`) tracking the package's install state — all firing in the same tight window Patrol's install→test→uninstall cycle runs in.

Checked whether this device is under enterprise/MDM management (which would explain unusually heavy package-lifecycle instrumentation): **it is not** — `adb shell dpm list-owners` returns "no owners," and `pm list users` shows only a single `Owner` profile, no separate managed/work profile. The one active device admin is `com.samsung.android.kgclient` (Knox Guard / Find My Mobile's reactivation lock) — standard on any retail Samsung device with a Samsung account signed in, not evidence of special management.

**Revised hypothesis**: not "this specific device is unusually managed," but "Samsung's baseline Knox security platform — present on every Samsung device out of the box, managed or not — may be interfering with Patrol's fast multi-APK install cycle (app + test orchestrator + test bundle installed back-to-back)." Weaker and less unique than the MDM theory, but still the most concrete, evidence-backed lead in this entire investigation. **Not confirmed** — the clean way to test it: try the identical setup on a non-Samsung device.

## Samsung theory decisively ruled out — tested on a second, unrelated device

Connected a completely different phone: **Huawei BKK-LX2, Android 8.1 (API 27)** — different manufacturer, different Android version by 4 major versions, no Knox anywhere in its stack. Ran the identical `patrol test --target patrol_test/control_test.dart` directly via `patrol_cli`.

**Result: identical failure** — `"Total: 0"` tests discovered, same fast completion (2.2s build, 1.5s execute), same signature as every prior attempt on the Samsung device.

This rules out device/OEM/manufacturer entirely as a variable. Failing identically on two unrelated phones (different vendor, different Android major version, different years) means the common factor is our side: the host machine's toolchain, or this project's specific configuration — not the phone.

**New leading hypothesis**: Flutter 3.47.1 is extremely recent (days old at time of testing). GitHub issue `#3238` — filed 8 days before this investigation — already documents a real incompatibility between Patrol's Kotlin Gradle Plugin handling and Flutter 3.47's new built-in-Kotlin support model, though that reporter saw only a cosmetic build warning. It's plausible we're hitting a more severe manifestation of the same root incompatibility, since we're actually executing instrumentation tests, not just building. **Next test**: downgrade to an older, more established Flutter version (3.35.7 is already cached locally via fvm) and retry — if it works there, this is confirmed as a Flutter-version/Patrol-version incompatibility, not a device issue at all.

## Flutter-version downgrade tested — inconclusive, not a fix

Created a fresh, isolated project (`fixtures/patrol_isolation_test`) scaffolded directly with Flutter 3.35.7, pinned via `fvm`. Hit a genuine configuration trap along the way worth recording: `fvm use` correctly updated the `.fvm` symlink and `fvm flutter --version` correctly reported 3.35.7, but **`android/local.properties`'s `flutter.sdk` path — which is what Gradle actually reads for the build, independent of the `fvm`/`PATH` resolution — still pointed at 3.47.1.** This caused a misleading chain of ever-climbing Gradle/AGP/Kotlin version-mismatch errors that looked like real incompatibilities but were actually just Flutter 3.47.1's real requirements being enforced the whole time, not 3.35.7's. Fixed by editing `local.properties` directly and reverting the version bumps back to what `flutter create` originally generated under 3.35.7.

**With that genuinely fixed**, reran `patrol test` against the Huawei device on true Flutter 3.35.7:

- No more "app shut down before test reported completion" message at all — a real behavioral difference from every single Flutter 3.47.1 attempt.
- Execution took a genuine 14 seconds, versus the suspicious 1–3 second "instant failures" seen every time on 3.47.1.
- **But still `"Total: 0"` tests discovered**, and the app's package name (`com.flutterMedic.fixtures.patrol_isolation_test`) never appears anywhere in `adb logcat`, at all, during or after those 14 seconds.

**Conclusion: not a fix, but not nothing either.** The symptom genuinely changed (no crash message, longer execution window) — meaning Flutter's version does affect *something* about this failure — but the outcome is still broken: zero tests ever run, and the app apparently never even logs anything, suggesting it may never actually launch in either Flutter version. This doesn't confirm the Flutter-3.47-incompatibility hypothesis as a complete explanation, since the older version still fails, just differently. **This is where the Patrol investigation stops.** Every reasonably-cheap avenue has been tried: versions, session state, external processes, app code, two completely different physical devices, direct `patrol_cli` bypassing `patrol_mcp`, and now a genuine Flutter version downgrade. Root cause remains unknown. This is not a blocker for Phase 1.

## Product design implication: who writes the Patrol test file?

Not the end developer — that would contradict the spec's core pitch ("don't write the test, tell the AI what you want verified"). Since `patrol_mcp`'s `run` tool requires a `testFile` path (no live tap/type equivalent, confirmed above), **the orchestrator itself must generate ephemeral Patrol test files programmatically** whenever it needs Patrol's native-OS capabilities mid-investigation (permission dialogs, system UI) — write a throwaway `.dart` file, call `run`, clean it up after. The developer never sees it, same as they never see a Marionette script.

Separate from this: Patrol's own native use case (outside flutter-medic) is real developers hand-authoring *persistent* Patrol tests checked into the repo for CI — that's a different, legitimate later use case (§8.1 "Regression" mode, Phase 6 CI integration), where flutter-medic might deliberately *write* a persistent regression test as an artifact of a bug it found and fixed. Not to be confused with the ephemeral in-investigation case above.

## Single-binding constraint — still not directly tested

Haven't yet tried running Marionette and Patrol against the same live app process simultaneously (the specific scenario §11 warns about). The `run` failure above happened with Marionette's binding present in `main.dart` but, per the hypothesis above, likely not actually in Patrol's execution path — so this doesn't yet count as a real test of the constraint either way.

## Open questions for the rest of Phase 0

- Does Marionette's tap/type/scroll avoid the driver-extension setup requirement, or does it hit the same friction?
- What does `get_runtime_errors` actually return for a real thrown exception (not yet tested)?
- Is the single-binding constraint (Marionette vs. Patrol) real, and what does violating it actually look like?
- What does Marionette's `get_logs` return relative to Dart MCP's log/error tools — redundant, or complementary?
