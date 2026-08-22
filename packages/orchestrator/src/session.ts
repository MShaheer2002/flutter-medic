import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { detectAndroidDevice } from "./device-detection.js";
import {
  MARIONETTE_MCP_BIN,
  connectDartMcpToApp,
  connectStdioClient,
  forceStopApp,
  getRuntimeErrors,
  launchApp as spawnFlutterRun,
  toolText,
  waitForVmServiceUri,
} from "./mcp-clients.js";
import { captureLogMarker, getAndroidApplicationId, readFlutterLogSince } from "./native-log.js";
import { reproduce as runReproduction, type InvestigationStep } from "./reproduction.js";

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
}

let activeSession: Session | null = null;

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
  };

  return { deviceId: device.id, deviceName: device.name, appPath };
}

export async function closeApp() {
  if (!activeSession) {
    return { message: "No active session — nothing to close." };
  }
  const { marionette, dartMcp, appProcess, deviceId, applicationId } = activeSession;
  await marionette.close();
  await dartMcp.close();
  appProcess.kill();
  await forceStopApp(deviceId, applicationId);
  activeSession = null;
  return { message: "Session closed." };
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

  session.logMarker = await captureLogMarker(session.deviceId);

  return { interactiveElements, runtimeErrors, nativeLog };
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
  return runReproduction(
    session.marionette,
    session.dartMcp,
    session.deviceId,
    session.applicationId,
    session.appPath,
    steps,
    expectedElementKey,
  );
}
