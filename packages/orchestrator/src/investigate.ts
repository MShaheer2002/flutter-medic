import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { detectAndroidDevice } from "./device-detection.js";
import {
  MARIONETTE_MCP_BIN,
  connectDartMcpToApp,
  connectStdioClient,
  forceStopApp,
  launchApp,
  waitForVmServiceUri,
} from "./mcp-clients.js";
import { getAndroidApplicationId } from "./native-log.js";
import { reproduce, type InvestigationStep } from "./reproduction.js";

export type { InvestigationStep };

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

export interface EvidenceReport {
  goal: string;
  deviceId: string;
  deviceName?: string;
  reproductionCount: number;
  reproductionRuns: number;
  verdict: "confirmed" | "not-reproduced";
  runs: import("./reproduction.js").RunResult[];
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

  const result = await reproduce(
    marionette,
    dartMcp,
    device.id,
    applicationId,
    params.appPath,
    params.steps,
    params.expectedElementKey,
  );

  await marionette.close();
  await dartMcp.close();
  appProcess.kill();
  await forceStopApp(device.id, applicationId);

  return { goal: params.goal, deviceId: device.id, deviceName: device.name, ...result };
}

// CLI entry point — only runs when this file is executed directly, not when imported.
// Deliberately app-agnostic: what to check comes entirely from the config file,
// not a hardcoded default — the tool doesn't know or care what bug it's looking
// for until it's told.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [appPath, configPath, deviceId] = process.argv.slice(2);
  if (!appPath || !configPath) {
    console.error("Usage: investigate <app-path> <config.json> [device-id]");
    console.error('config.json shape: { "goal": string, "steps": InvestigationStep[], "expectedElementKey"?: string }');
    process.exit(1);
  }

  const config: Pick<InvestigateParams, "goal" | "steps" | "expectedElementKey"> = JSON.parse(
    await readFile(configPath, "utf-8"),
  );

  runInvestigation({ deviceId, appPath, ...config })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.verdict === "confirmed" ? 0 : 1;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
