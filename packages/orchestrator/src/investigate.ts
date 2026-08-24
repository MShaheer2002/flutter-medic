import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { resolveDevice } from "./device-detection.js";
import {
  MARIONETTE_MCP_BIN,
  connectDartMcpToApp,
  connectStdioClient,
  launchApp,
  waitForVmServiceUri,
} from "./mcp-clients.js";
import { forceStopApp, getApplicationId } from "./platform-support.js";
import { reproduce, type InvestigationStep } from "./reproduction.js";
import { generateReport } from "./report.js";

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
  /** Human-readable markdown summary of the findings above. */
  report: string;
}

export async function runInvestigation(params: InvestigateParams): Promise<EvidenceReport> {
  const device = await resolveDevice(params.deviceId);

  const appProcess = launchApp(device.id, params.appPath);
  const vmServiceUri = await waitForVmServiceUri(appProcess);

  const marionette = await connectStdioClient(MARIONETTE_MCP_BIN);
  await marionette.callTool({ name: "connect", arguments: { uri: vmServiceUri } });

  const dartMcp = await connectStdioClient("dart", ["mcp-server"]);
  await connectDartMcpToApp(dartMcp, params.appPath);

  const applicationId = await getApplicationId(device.platform, params.appPath);

  const result = await reproduce(
    marionette,
    dartMcp,
    device.platform,
    device.id,
    device.isSimulator,
    applicationId,
    params.appPath,
    params.steps,
    params.expectedElementKey,
  );

  await marionette.close();
  await dartMcp.close();
  appProcess.kill();
  await forceStopApp(device.platform, device.id, device.isSimulator, applicationId);

  return {
    goal: params.goal,
    deviceId: device.id,
    deviceName: device.name,
    ...result,
    report: generateReport(result, params.goal),
  };
}

// CLI entry point — only runs when this file is executed directly, not when imported.
// Deliberately app-agnostic: what to check comes entirely from the config file,
// not a hardcoded default — the tool doesn't know or care what bug it's looking
// for until it's told.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rawArgs = process.argv.slice(2);
  // --ci flips exit-code polarity (Phase 6, §13). Without it, this CLI's
  // historical convention is "confirmed = 0" — useful for self-testing
  // flutter-medic itself against a known bug (did it correctly confirm what
  // we expected?). That's the wrong polarity for an actual CI gate on a real
  // project: there, a confirmed bug must FAIL the check, not pass it. Two
  // different questions ("did the tool work?" vs "is the app healthy?")
  // sharing one exit code would silently break one of them — --ci exists so
  // callers say which question they're asking instead of guessing.
  const ci = rawArgs.includes("--ci");
  const [appPath, configPath, deviceId] = rawArgs.filter((a) => a !== "--ci");
  if (!appPath || !configPath) {
    console.error("Usage: investigate <app-path> <config.json> [device-id] [--ci]");
    console.error('config.json shape: { "goal": string, "steps": InvestigationStep[], "expectedElementKey"?: string }');
    console.error("--ci: exit 1 if a bug is confirmed (CI gate). Without it, exit 0 on confirmed (self-test convention).");
    process.exit(1);
  }

  const config: Pick<InvestigateParams, "goal" | "steps" | "expectedElementKey"> = JSON.parse(
    await readFile(configPath, "utf-8"),
  );

  runInvestigation({ deviceId, appPath, ...config })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      const confirmed = report.verdict === "confirmed";
      process.exitCode = ci ? (confirmed ? 1 : 0) : confirmed ? 0 : 1;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
