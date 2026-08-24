import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import {
  detectBaselineDrift,
  detectMissingExpectedElement,
  detectNativeLogException,
  detectRuntimeException,
  type AnomalySignal,
} from "./anomaly-detection.js";
import { loadBaseline, saveBaseline } from "./baseline.js";
import type { DevicePlatform } from "./device-detection.js";
import { connectDartMcpToApp, getNetworkActivity, getRuntimeErrors, hotRestartTwice, toolText } from "./mcp-clients.js";
import { captureLogMarker, readNativeLogSince } from "./platform-support.js";

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
  networkActivity: string;
  nativeLog: string;
}

export interface ReproductionResult {
  reproductionCount: number;
  reproductionRuns: number;
  verdict: "confirmed" | "not-reproduced";
  runs: RunResult[];
}

export async function runInteractionSteps(marionette: Client, steps: InvestigationStep[]) {
  for (const step of steps) {
    if (step.action === "enter_text") {
      await marionette.callTool({ name: "enter_text", arguments: { key: step.key, input: step.input ?? "" } });
    } else {
      await marionette.callTool({ name: "tap", arguments: { key: step.key } });
    }
  }
}

/**
 * A fixed sleep after interaction steps isn't reliable — found live: even
 * 1500ms was sometimes too short for a route transition to finish, so
 * evidence got captured on the screen being navigated AWAY from (doc/016).
 * Polls until the UI has actually stopped changing, instead of guessing a
 * bigger constant.
 *
 * Requires `requiredStableReads` consecutive identical reads, not just two
 * (doc/024) — two was too eager: if the isolate/engine is genuinely busy or
 * blocked for longer than one poll interval (during cold-start init, or
 * right after hot_restart), get_interactive_elements can return the exact
 * same frozen, stale frame on two back-to-back polls, falsely looking
 * "stable" long before the real final frame ever renders. Requiring one
 * more consecutive match raises confidence without changing the bounded
 * worst-case wait.
 */
export async function waitForStableUi(
  marionette: Client,
  maxWaitMs = 5000,
  pollIntervalMs = 300,
  requiredStableReads = 3,
): Promise<string> {
  let previous: string | null = null;
  let matchStreak = 0;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const current = toolText(await marionette.callTool({ name: "get_interactive_elements" }));
    if (current === previous) {
      matchStreak++;
      if (matchStreak >= requiredStableReads - 1) return current;
    } else {
      matchStreak = 0;
    }
    previous = current;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return previous ?? "";
}

async function runOnce(
  marionette: Client,
  dartMcp: Client,
  platform: DevicePlatform,
  deviceId: string,
  isSimulator: boolean,
  applicationId: string,
  appPath: string,
  steps: InvestigationStep[],
  expectedElementKey: string | undefined,
): Promise<RunResult> {
  // Both the Dart MCP connection and this log marker must be captured BEFORE
  // the interaction steps run, not after — see connectDartMcpToApp's docstring
  // and doc/007 for why connecting/marking late silently misses everything.
  const logMarker = await captureLogMarker(platform, deviceId);

  await runInteractionSteps(marionette, steps);

  const interactiveElements = await waitForStableUi(marionette);
  const runtimeErrors = await getRuntimeErrors(dartMcp);
  const nativeLog = await readNativeLogSince(platform, deviceId, isSimulator, applicationId, logMarker);
  const networkActivity = await getNetworkActivity(dartMcp);

  const signals: AnomalySignal[] = [];
  const exceptionSignal = detectRuntimeException(runtimeErrors);
  if (exceptionSignal) signals.push(exceptionSignal);

  const nativeLogSignal = detectNativeLogException(nativeLog);
  if (nativeLogSignal) signals.push(nativeLogSignal);

  if (expectedElementKey) {
    const missingSignal = detectMissingExpectedElement(interactiveElements, expectedElementKey);
    if (missingSignal) signals.push(missingSignal);
  }

  // Tier-2: first known-good run for this exact app+steps banks the baseline;
  // every later run diffs against it. Never bank a run that already has a
  // tier-1 signal — that would make a broken state look "known good."
  const baseline = await loadBaseline(appPath, steps, expectedElementKey);
  if (baseline !== null) {
    const driftSignal = detectBaselineDrift(interactiveElements, baseline);
    if (driftSignal) signals.push(driftSignal);
  } else if (signals.length === 0) {
    await saveBaseline(appPath, steps, expectedElementKey, interactiveElements).catch(() => {});
  }

  return { anomalyDetected: signals.length > 0, signals, interactiveElements, networkActivity, nativeLog };
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
  platform: DevicePlatform,
  deviceId: string,
  isSimulator: boolean,
  applicationId: string,
  appPath: string,
  steps: InvestigationStep[],
  expectedElementKey: string | undefined,
): Promise<ReproductionResult> {
  const runs: RunResult[] = [];
  for (let i = 0; i < REPRODUCTION_RUNS; i++) {
    runs.push(
      await runOnce(marionette, dartMcp, platform, deviceId, isSimulator, applicationId, appPath, steps, expectedElementKey),
    );
    if (i < REPRODUCTION_RUNS - 1) {
      // hotRestartTwice, not a single hot_restart — works around a real
      // marionette_mcp race that stuck evidence on a dying old isolate
      // (doc/024). Fixes the actual bug 016/019 documented, not the symptom.
      await hotRestartTwice(marionette);
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
