import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import {
  detectMissingExpectedElement,
  detectNativeLogException,
  detectRuntimeException,
  type AnomalySignal,
} from "./anomaly-detection.js";
import { FLUTTER_BIN, getFlutterVersion, resolveDevice, type DevicePlatform } from "./device-detection.js";
import {
  MARIONETTE_MCP_BIN,
  connectDartMcpToApp,
  connectStdioClient,
  getNetworkActivity,
  getRuntimeErrors,
  hotRestartTwice,
  launchApp as spawnFlutterRun,
  toolText,
  waitForVmServiceUri,
} from "./mcp-clients.js";
import { instrumentFile, revertAll, revertFile } from "./instrumentation.js";
import { tapNativeAndroid, tapNativeIos } from "./native-tap.js";
import { captureLogMarker, forceStopApp, getApplicationId, readNativeLogSince } from "./platform-support.js";
import {
  reproduce as runReproduction,
  runInteractionSteps,
  waitForStableUi,
  type InvestigationStep,
} from "./reproduction.js";
import { generateReport } from "./report.js";

// Session state for the granular tools (launch_app/tap/enter_text/observe/
// hot_restart/close_app). One active session at a time — matches the MVP's
// scope (investigate one app at a time), not a multi-session manager.
// investigate() stays fully self-contained (its own launch/connect/teardown
// per call) since it doesn't need cross-call state; this module exists
// specifically so a calling agent can drive an app step by step, doing its
// own planning/judgment between calls (Phase 2's "let the AI client plan"
// design — see doc/010).
interface Session {
  marionette: Client;
  dartMcp: Client;
  appProcess: ChildProcessWithoutNullStreams;
  appPath: string;
  applicationId: string;
  platform: DevicePlatform;
  deviceId: string;
  deviceName?: string;
  isSimulator: boolean;
  logMarker: string;
  /** Original content of any files instrument_code has touched, keyed by absolute path. */
  instrumentedFiles: Map<string, string>;
}

let activeSession: Session | null = null;

// Matches Marionette's own element-targeting: exactly one of these should be
// given per call. `type` is the widget's Flutter type name (e.g. "ListTile").
export interface ElementMatcher {
  key?: string;
  text?: string;
  type?: string;
  coordinates?: { x: number; y: number };
}

function requireSession(): Session {
  if (!activeSession) {
    throw new Error("No active session. Call launch_app first.");
  }
  return activeSession;
}

export async function launchAppSession(appPath: string, deviceId?: string) {
  if (activeSession) {
    throw new Error("A session is already active. Call close_app before launching another.");
  }

  const device = await resolveDevice(deviceId);
  const flutterVersion = await getFlutterVersion(FLUTTER_BIN);

  const appProcess = spawnFlutterRun(device.id, appPath);
  const vmServiceUri = await waitForVmServiceUri(appProcess);

  const marionette = await connectStdioClient(MARIONETTE_MCP_BIN);
  await marionette.callTool({ name: "connect", arguments: { uri: vmServiceUri } });

  const dartMcp = await connectStdioClient("dart", ["mcp-server"]);
  await connectDartMcpToApp(dartMcp, appPath);

  const applicationId = await getApplicationId(device.platform, appPath);
  const logMarker = await captureLogMarker(device.platform, device.id);

  activeSession = {
    marionette,
    dartMcp,
    appProcess,
    appPath,
    applicationId,
    platform: device.platform,
    deviceId: device.id,
    deviceName: device.name,
    isSimulator: device.isSimulator,
    logMarker,
    instrumentedFiles: new Map(),
  };

  return { deviceId: device.id, deviceName: device.name, appPath, flutterVersion };
}

export async function closeApp() {
  if (!activeSession) {
    return { message: "No active session — nothing to close." };
  }
  const { marionette, dartMcp, appProcess, platform, deviceId, isSimulator, applicationId, instrumentedFiles } = activeSession;
  // Safety net: restore anything still instrumented, even if the caller
  // forgot to call revert_instrumentation — never leave the app's real
  // source files mutated after the session ends.
  const reverted = await revertAll(instrumentedFiles);
  await marionette.close();
  await dartMcp.close();
  appProcess.kill();
  await forceStopApp(platform, deviceId, isSimulator, applicationId);
  activeSession = null;
  return {
    message:
      reverted.length > 0
        ? `Session closed. Auto-reverted ${reverted.length} still-instrumented file(s): ${reverted.join(", ")}`
        : "Session closed.",
  };
}

export async function tap(matcher: ElementMatcher) {
  const session = requireSession();
  await session.marionette.callTool({ name: "tap", arguments: { ...matcher } });
  return { message: "Tapped." };
}

export async function enterText(key: string, input: string) {
  const session = requireSession();
  await session.marionette.callTool({ name: "enter_text", arguments: { key, input } });
  return { message: `Entered text into element with key "${key}".` };
}

/**
 * Raw evidence, no judgment applied — the calling agent decides what it
 * means. Log output covers everything since the last observe() call (or
 * since launch_app, on the first call).
 */
export async function observe() {
  const session = requireSession();

  const interactiveElements = toolText(await session.marionette.callTool({ name: "get_interactive_elements" }));
  const runtimeErrors = await getRuntimeErrors(session.dartMcp);
  const nativeLog = await readNativeLogSince(
    session.platform,
    session.deviceId,
    session.isSimulator,
    session.applicationId,
    session.logMarker,
  );
  const networkActivity = await getNetworkActivity(session.dartMcp);

  session.logMarker = await captureLogMarker(session.platform, session.deviceId);

  return { interactiveElements, runtimeErrors, nativeLog, networkActivity };
}

export async function hotRestart() {
  const session = requireSession();
  // hotRestartTwice, not a single hot_restart — works around a real
  // marionette_mcp race that stuck evidence on a dying old isolate (024).
  await hotRestartTwice(session.marionette);
  await new Promise((r) => setTimeout(r, 1500));
  // New isolate after restart — Dart MCP's DTD connection needs re-establishing,
  // same lesson as investigate.ts and doc/007.
  await connectDartMcpToApp(session.dartMcp, session.appPath);
  session.logMarker = await captureLogMarker(session.platform, session.deviceId);
  return { message: "Hot restart complete." };
}

/**
 * Verifies steps discovered through exploration, against the app already open
 * from launch_app — hot-restarts between attempts like investigate() does,
 * but never terminates or relaunches the app, since it's already running.
 * Use this after exploring with observe/tap/enter_text, once you know what to
 * check; use investigate() instead when you already know everything upfront
 * and don't need a separate exploration session first.
 */
export async function reproduce(steps: InvestigationStep[], expectedElementKey?: string) {
  const session = requireSession();
  const result = await runReproduction(
    session.marionette,
    session.dartMcp,
    session.platform,
    session.deviceId,
    session.isSimulator,
    session.applicationId,
    session.appPath,
    steps,
    expectedElementKey,
  );
  return { ...result, report: generateReport(result) };
}

export async function doubleTap(matcher: ElementMatcher, delay?: number) {
  const session = requireSession();
  await session.marionette.callTool({ name: "double_tap", arguments: { ...matcher, delay } });
  return { message: "Double-tapped." };
}

export async function longPress(matcher: ElementMatcher, duration?: number) {
  const session = requireSession();
  await session.marionette.callTool({ name: "long_press", arguments: { ...matcher, duration } });
  return { message: "Long-pressed." };
}

/** Desktop only — dispatches a secondary-button (right-click) pointer event. */
export async function secondaryTap(matcher: ElementMatcher) {
  const session = requireSession();
  await session.marionette.callTool({ name: "secondary_tap", arguments: { ...matcher } });
  return { message: "Secondary-tapped." };
}

export interface SwipeParams {
  /** Element-based mode: target + direction (+ optional distance). */
  key?: string;
  text?: string;
  direction?: "left" | "right" | "up" | "down";
  distance?: number;
  /** Coordinate-based mode: all four required together, instead of the above. */
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

export async function swipe(params: SwipeParams) {
  const session = requireSession();
  await session.marionette.callTool({ name: "swipe", arguments: { ...params } });
  return { message: "Swiped." };
}

/** scale > 1 zooms in, scale < 1 zooms out. */
export async function pinchZoom(matcher: ElementMatcher, scale: number, startDistance?: number) {
  const session = requireSession();
  await session.marionette.callTool({
    name: "pinch_zoom",
    arguments: { ...matcher, scale, start_distance: startDistance },
  });
  return { message: "Pinch-zoomed." };
}

/** Scrolls the view until an element matching key/text becomes visible. */
export async function scrollTo(key?: string, text?: string) {
  const session = requireSession();
  await session.marionette.callTool({ name: "scroll_to", arguments: { key, text } });
  return { message: "Scrolled." };
}

/** Android back / iOS swipe-back. Pops a route if there's one to pop. */
export async function pressBackButton() {
  const session = requireSession();
  const result = await session.marionette.callTool({ name: "press_back_button" });
  return { message: toolText(result) };
}

/**
 * Taps a native OS element (a permission dialog, a system sign-in sheet) by
 * visible text/label — outside the Flutter widget tree entirely, so
 * Marionette's tap can't reach it. Android only for now (see native-tap.ts);
 * iOS needs idb, not yet wired in.
 */
export async function tapNative(label: string) {
  const session = requireSession();
  const result =
    session.platform === "android"
      ? await tapNativeAndroid(session.deviceId, label)
      : await tapNativeIos(session.deviceId, label);
  return { message: `Tapped native element matching "${result.matchedLabel}" at (${result.x}, ${result.y}).` };
}

/**
 * Real key events through the focus system (unlike enter_text, which just
 * replaces a field's value) — for submit-on-enter, tab navigation, escape,
 * arrow keys, or shortcuts via modifiers (e.g. "control,shift").
 */
export async function pressKey(key: string, modifiers?: string) {
  const session = requireSession();
  await session.marionette.callTool({ name: "press_key", arguments: { key, modifiers } });
  return { message: `Pressed key "${key}".` };
}

/** Base64 PNG(s) of the current visual state — one per view. */
export async function takeScreenshots() {
  const session = requireSession();
  const result = await session.marionette.callTool({ name: "take_screenshots" });
  const content = (result as { content: Array<{ type: string; data?: string; mimeType?: string }> }).content;
  return { screenshots: content.filter((c) => c.type === "image").map((c) => ({ data: c.data, mimeType: c.mimeType })) };
}

/** Marionette's own app log collector — separate from observe()'s VM-service/logcat evidence. */
export async function getLogs() {
  const session = requireSession();
  const result = await session.marionette.callTool({ name: "get_logs" });
  return { logs: toolText(result) };
}

/** Reloads Dart code without restarting the app — preserves state, unlike hot_restart. */
export async function hotReload() {
  const session = requireSession();
  await session.marionette.callTool({ name: "hot_reload" });
  return { message: "Hot reload complete." };
}

/**
 * Temporary code instrumentation (Phase 3, §13) — for bugs that don't show
 * up in any existing evidence stream, temporarily insert extra logging into
 * the app's own source, then hot_reload/hot_restart to pick it up and
 * observe again. filePath is relative to the app root and must resolve
 * inside it. Call revert_instrumentation when done — close_app also reverts
 * automatically as a safety net if you forget.
 */
export async function instrumentCode(filePath: string, atLine: number, code: string) {
  const session = requireSession();
  await instrumentFile(session.instrumentedFiles, session.appPath, filePath, atLine, code);
  return {
    message: `Inserted instrumentation into ${filePath} as the new line ${atLine + 1}. Call hot_reload (or hot_restart) to pick it up.`,
  };
}

/** Restores a file instrument_code touched back to its original content. Omit filePath to revert everything. */
export async function revertInstrumentation(filePath?: string) {
  const session = requireSession();
  if (filePath) {
    const reverted = await revertFile(session.instrumentedFiles, session.appPath, filePath);
    return { message: reverted ? `Reverted ${filePath}.` : `${filePath} was not instrumented — nothing to revert.` };
  }
  const reverted = await revertAll(session.instrumentedFiles);
  return {
    message: reverted.length > 0 ? `Reverted ${reverted.length} file(s): ${reverted.join(", ")}` : "Nothing was instrumented.",
  };
}

/**
 * Phase 4 (§13) "hot-reload-and-reverify cycle" — after a coding agent edits
 * the app's source to fix a bug found by investigate/reproduce, call this to
 * check whether it worked.
 *
 * Two modes, because live testing found hot_reload alone isn't always
 * enough: hot_reload preserves widget state, so it verifies in place without
 * losing navigation — but a fix inside a function that already ran once
 * (e.g. an initState-triggered fetch) won't re-run just because the code
 * changed; hot_reload doesn't re-trigger lifecycle methods. For that class
 * of bug, pass reloadMode: "hot_restart" and the original `steps` — this
 * resets state and replays them, so the fixed code actually executes again.
 * Use "hot_reload" (the default) when the bug is in something re-evaluated
 * on every build, where losing navigation state would be wasteful.
 *
 * Uses waitForStableUi for the interactiveElements read, same as
 * reproduction.ts — best-effort, does not fully close the known
 * post-hot_restart evidence-staleness gap from doc/016.
 */
export async function verifyFix(
  expectedElementKey?: string,
  reloadMode: "hot_reload" | "hot_restart" = "hot_reload",
  steps?: InvestigationStep[],
) {
  const session = requireSession();
  if (reloadMode === "hot_restart") {
    // hotRestartTwice, not a single hot_restart — works around a real
    // marionette_mcp race that stuck evidence on a dying old isolate (024).
    await hotRestartTwice(session.marionette);
    await new Promise((r) => setTimeout(r, 1500));
    await connectDartMcpToApp(session.dartMcp, session.appPath);
    if (steps) await runInteractionSteps(session.marionette, steps);
  } else {
    await session.marionette.callTool({ name: "hot_reload" });
    await new Promise((r) => setTimeout(r, 500));
  }

  const interactiveElements = await waitForStableUi(session.marionette);
  const runtimeErrors = await getRuntimeErrors(session.dartMcp);
  const nativeLog = await readNativeLogSince(
    session.platform,
    session.deviceId,
    session.isSimulator,
    session.applicationId,
    session.logMarker,
  );
  const networkActivity = await getNetworkActivity(session.dartMcp);
  session.logMarker = await captureLogMarker(session.platform, session.deviceId);

  const signals: AnomalySignal[] = [];
  const exceptionSignal = detectRuntimeException(runtimeErrors);
  if (exceptionSignal) signals.push(exceptionSignal);
  const nativeLogSignal = detectNativeLogException(nativeLog);
  if (nativeLogSignal) signals.push(nativeLogSignal);
  if (expectedElementKey) {
    const missingSignal = detectMissingExpectedElement(interactiveElements, expectedElementKey);
    if (missingSignal) signals.push(missingSignal);
  }

  return {
    fixed: signals.length === 0,
    signals,
    interactiveElements,
    runtimeErrors,
    nativeLog,
    networkActivity,
  };
}
