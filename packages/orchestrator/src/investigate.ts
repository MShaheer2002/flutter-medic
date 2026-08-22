import { pathToFileURL } from "node:url";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import {
  detectMissingExpectedElement,
  detectNativeLogException,
  detectRuntimeException,
  type AnomalySignal,
} from "./anomaly-detection.js";
import { detectAndroidDevice } from "./device-detection.js";
import {
  MARIONETTE_MCP_BIN,
  connectDartMcpToApp,
  connectStdioClient,
  forceStopApp,
  getRuntimeErrors,
  launchApp,
  toolText,
  waitForVmServiceUri,
} from "./mcp-clients.js";
import { captureLogMarker, getAndroidApplicationId, readFlutterLogSince } from "./native-log.js";

const REPRODUCTION_RUNS = 3;

export interface InvestigationStep {
  action: "tap" | "enter_text";
  key: string;
  /** Required for "enter_text". */
  input?: string;
}

export interface InvestigateParams {
  /** If omitted, auto-detects the single connected physical Android device. */
  deviceId?: string;
  /** Absolute path to the Flutter project to investigate. */
  appPath: string;
  /** Human-readable description of what's being verified — carried through to the report. */
  goal: string;
  /** Interaction steps to reach the state worth observing. */
  steps: InvestigationStep[];
  /** If given, its absence after `steps` run is treated as a tier-1 anomaly signal. */
  expectedElementKey?: string;
}

export interface RunResult {
  anomalyDetected: boolean;
  signals: AnomalySignal[];
  interactiveElements: string;
}

export interface EvidenceReport {
  goal: string;
  deviceId: string;
  deviceName?: string;
  reproductionCount: number;
  reproductionRuns: number;
  verdict: "confirmed" | "not-reproduced";
  runs: RunResult[];
}

async function runInteractionSteps(marionette: Client, steps: InvestigationStep[]) {
  for (const step of steps) {
    if (step.action === "enter_text") {
      await marionette.callTool({ name: "enter_text", arguments: { key: step.key, input: step.input ?? "" } });
    } else {
      await marionette.callTool({ name: "tap", arguments: { key: step.key } });
    }
  }
}

async function runInvestigationOnce(
  marionette: Client,
  dartMcp: Client,
  deviceId: string,
  applicationId: string,
  params: InvestigateParams,
): Promise<RunResult> {
  // Both the Dart MCP connection and this log marker must be captured BEFORE
  // the interaction steps run, not after — see connectDartMcpToApp's docstring
  // and doc/007 for why connecting/marking late silently misses everything.
  const logMarker = await captureLogMarker(deviceId);

  await runInteractionSteps(marionette, params.steps);

  // Let navigation and any async work triggered by the steps settle.
  await new Promise((r) => setTimeout(r, 800));

  const interactiveElements = toolText(await marionette.callTool({ name: "get_interactive_elements" }));
  const runtimeErrors = await getRuntimeErrors(dartMcp);
  const nativeLog = await readFlutterLogSince(deviceId, applicationId, logMarker);

  const signals: AnomalySignal[] = [];
  const exceptionSignal = detectRuntimeException(runtimeErrors);
  if (exceptionSignal) signals.push(exceptionSignal);

  const nativeLogSignal = detectNativeLogException(nativeLog);
  if (nativeLogSignal) signals.push(nativeLogSignal);

  if (params.expectedElementKey) {
    const missingSignal = detectMissingExpectedElement(interactiveElements, params.expectedElementKey);
    if (missingSignal) signals.push(missingSignal);
  }

  return { anomalyDetected: signals.length > 0, signals, interactiveElements };
}

export async function runInvestigation(params: InvestigateParams): Promise<EvidenceReport> {
  const device = params.deviceId ? { id: params.deviceId, name: undefined } : await detectAndroidDevice();

  const appProcess = launchApp(device.id, params.appPath);
  const vmServiceUri = await waitForVmServiceUri(appProcess);

  const marionette = await connectStdioClient(MARIONETTE_MCP_BIN);
  await marionette.callTool({ name: "connect", arguments: { uri: vmServiceUri } });

  const dartMcp = await connectStdioClient("dart", ["mcp-server"]);
  await connectDartMcpToApp(dartMcp, params.appPath);

  const applicationId = await getAndroidApplicationId(params.appPath);

  const runs: RunResult[] = [];
  for (let i = 0; i < REPRODUCTION_RUNS; i++) {
    runs.push(await runInvestigationOnce(marionette, dartMcp, device.id, applicationId, params));
    if (i < REPRODUCTION_RUNS - 1) {
      await marionette.callTool({ name: "hot_restart" });
      await new Promise((r) => setTimeout(r, 1500));
      // Hot restart creates a new isolate — Dart MCP's DTD connection needs
      // to be re-established, same as Marionette re-attaches automatically.
      await connectDartMcpToApp(dartMcp, params.appPath);
    }
  }

  const reproductionCount = runs.filter((r) => r.anomalyDetected).length;
  const report: EvidenceReport = {
    goal: params.goal,
    deviceId: device.id,
    deviceName: device.name,
    reproductionCount,
    reproductionRuns: REPRODUCTION_RUNS,
    verdict: reproductionCount === REPRODUCTION_RUNS ? "confirmed" : "not-reproduced",
    runs,
  };

  await marionette.close();
  await dartMcp.close();
  appProcess.kill();
  await forceStopApp(device.id, applicationId);
  return report;
}

// CLI entry point — only runs when this file is executed directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [appPath, deviceId] = process.argv.slice(2);
  if (!appPath) {
    console.error("Usage: investigate <app-path> [device-id]");
    process.exit(1);
  }

  runInvestigation({
    deviceId,
    appPath,
    goal: "Verify tasks appear on Home after login; find out why if they don't.",
    steps: [
      { action: "enter_text", key: "email_field", input: "dev@flutter-medic.test" },
      { action: "enter_text", key: "password_field", input: "hunter2" },
      { action: "tap", key: "login_button" },
    ],
    expectedElementKey: "tasks_list",
  })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.verdict === "confirmed" ? 0 : 1;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
