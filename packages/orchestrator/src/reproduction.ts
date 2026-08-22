import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import {
  detectMissingExpectedElement,
  detectNativeLogException,
  detectRuntimeException,
  type AnomalySignal,
} from "./anomaly-detection.js";
import { connectDartMcpToApp, getRuntimeErrors, toolText } from "./mcp-clients.js";
import { captureLogMarker, readFlutterLogSince } from "./native-log.js";

const REPRODUCTION_RUNS = 3;

export interface InvestigationStep {
  action: "tap" | "enter_text";
  key: string;
  /** Required for "enter_text". */
  input?: string;
}

export interface RunResult {
  anomalyDetected: boolean;
  signals: AnomalySignal[];
  interactiveElements: string;
}

export interface ReproductionResult {
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

async function runOnce(
  marionette: Client,
  dartMcp: Client,
  deviceId: string,
  applicationId: string,
  steps: InvestigationStep[],
  expectedElementKey: string | undefined,
): Promise<RunResult> {
  // Both the Dart MCP connection and this log marker must be captured BEFORE
  // the interaction steps run, not after — see connectDartMcpToApp's docstring
  // and doc/007 for why connecting/marking late silently misses everything.
  const logMarker = await captureLogMarker(deviceId);

  await runInteractionSteps(marionette, steps);

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

  if (expectedElementKey) {
    const missingSignal = detectMissingExpectedElement(interactiveElements, expectedElementKey);
    if (missingSignal) signals.push(missingSignal);
  }

  return { anomalyDetected: signals.length > 0, signals, interactiveElements };
}

/**
 * Runs `steps` against an ALREADY-connected app REPRODUCTION_RUNS times,
 * hot-restarting between attempts — never launches or closes anything. Shared
 * by investigate() (which owns the whole launch/connect/close lifecycle) and
 * session.ts's reproduce() (which reuses a launch_app session already open,
 * so exploring and then verifying doesn't require a full terminate+relaunch).
 */
export async function reproduce(
  marionette: Client,
  dartMcp: Client,
  deviceId: string,
  applicationId: string,
  appPath: string,
  steps: InvestigationStep[],
  expectedElementKey: string | undefined,
): Promise<ReproductionResult> {
  const runs: RunResult[] = [];
  for (let i = 0; i < REPRODUCTION_RUNS; i++) {
    runs.push(await runOnce(marionette, dartMcp, deviceId, applicationId, steps, expectedElementKey));
    if (i < REPRODUCTION_RUNS - 1) {
      await marionette.callTool({ name: "hot_restart" });
      await new Promise((r) => setTimeout(r, 1500));
      // Hot restart creates a new isolate — Dart MCP's DTD connection needs
      // to be re-established, same as Marionette re-attaches automatically.
      await connectDartMcpToApp(dartMcp, appPath);
    }
  }

  const reproductionCount = runs.filter((r) => r.anomalyDetected).length;
  return {
    reproductionCount,
    reproductionRuns: REPRODUCTION_RUNS,
    verdict: reproductionCount === REPRODUCTION_RUNS ? "confirmed" : "not-reproduced",
    runs,
  };
}
