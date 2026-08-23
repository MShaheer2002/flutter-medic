import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { detectAndroidDevice } from "./device-detection.js";
import {
  MARIONETTE_MCP_BIN,
  connectDartMcpToApp,
  connectStdioClient,
  forceStopApp,
  getNetworkActivity,
  getRuntimeErrors,
  launchApp as spawnFlutterRun,
  toolText,
  waitForVmServiceUri,
} from "./mcp-clients.js";
import { instrumentFile, revertAll, revertFile } from "./instrumentation.js";
import { captureLogMarker, getAndroidApplicationId, readFlutterLogSince } from "./native-log.js";
import { reproduce as runReproduction, type InvestigationStep } from "./reproduction.js";
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
  deviceId: string;
  deviceName?: string;
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

  const device = deviceId ? { id: deviceId, name: undefined } : await detectAndroidDevice();

  const appProcess = spawnFlutterRun(device.id, appPath);
  const vmServiceUri = await waitForVmServiceUri(appProcess);

  const marionette = await connectStdioClient(MARIONETTE_MCP_BIN);
  await marionette.callTool({ name: "connect", arguments: { uri: vmServiceUri } });

  const dartMcp = await connectStdioClient("dart", ["mcp-server"]);
  await connectDartMcpToApp(dartMcp, appPath);

  const applicationId = await getAndroidApplicationId(appPath);
  const logMarker = await captureLogMarker(device.id);

  activeSession = {
    marionette,
    dartMcp,
    appProcess,
    appPath,
    applicationId,
    deviceId: device.id,
    deviceName: device.name,
    logMarker,
    instrumentedFiles: new Map(),
  };

  return { deviceId: device.id, deviceName: device.name, appPath };
}

export async function closeApp() {
  if (!activeSession) {
    return { message: "No active session — nothing to close." };
  }
  const { marionette, dartMcp, appProcess, deviceId, applicationId, instrumentedFiles } = activeSession;
  // Safety net: restore anything still instrumented, even if the caller
  // forgot to call revert_instrumentation — never leave the app's real
  // source files mutated after the session ends.
  const reverted = await revertAll(instrumentedFiles);
  await marionette.close();
  await dartMcp.close();
  appProcess.kill();
  await forceStopApp(deviceId, applicationId);
  activeSession = null;
  return {
    message:
      reverted.length > 0
        ? `Session closed. Auto-reverted ${reverted.length} still-instrumented file(s): ${reverted.join(", ")}`
        : "Session closed.",
  };
}

export async function tap(key: string) {
  const session = requireSession();
  await session.marionette.callTool({ name: "tap", arguments: { key } });
  return { message: `Tapped element with key "${key}".` };
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
  const nativeLog = await readFlutterLogSince(session.deviceId, session.applicationId, session.logMarker);
  const networkActivity = await getNetworkActivity(session.dartMcp);

  session.logMarker = await captureLogMarker(session.deviceId);

  return { interactiveElements, runtimeErrors, nativeLog, networkActivity };
}

export async function hotRestart() {
  const session = requireSession();
  await session.marionette.callTool({ name: "hot_restart" });
  await new Promise((r) => setTimeout(r, 1500));
  // New isolate after restart — Dart MCP's DTD connection needs re-establishing,
  // same lesson as investigate.ts and doc/007.
  await connectDartMcpToApp(session.dartMcp, session.appPath);
  session.logMarker = await captureLogMarker(session.deviceId);
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
    session.deviceId,
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
export async function instrumentCode(filePath: string, afterLine: number, code: string) {
  const session = requireSession();
  await instrumentFile(session.instrumentedFiles, session.appPath, filePath, afterLine, code);
  return { message: `Inserted instrumentation into ${filePath} after line ${afterLine}. Call hot_reload (or hot_restart) to pick it up.` };
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
