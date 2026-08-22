import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { detectMissingExpectedElement, detectRuntimeException, type AnomalySignal } from "./anomaly-detection.js";

const MARIONETTE_MCP_BIN = join(homedir(), ".pub-cache/bin/marionette_mcp");
const REPRODUCTION_RUNS = 3;

export interface InvestigationStep {
  action: "tap" | "enter_text";
  key: string;
  /** Required for "enter_text". */
  input?: string;
}

export interface InvestigateParams {
  deviceId: string;
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
  reproductionCount: number;
  reproductionRuns: number;
  verdict: "confirmed" | "not-reproduced";
  runs: RunResult[];
}

function launchApp(deviceId: string, appPath: string): ChildProcessWithoutNullStreams {
  return spawn("flutter", ["run", "-d", deviceId, "--debug"], { cwd: appPath });
}

function waitForVmServiceUri(proc: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/A Dart VM Service .* is available at: (http:\/\/[^\s]+)/);
      if (match) {
        proc.stdout.off("data", onData);
        resolve(match[1].replace("http://", "ws://") + "ws");
      }
    };
    proc.stdout.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`flutter run exited early (code ${code})`)));
  });
}

function toolText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
}

async function connectStdioClient(command: string, args: string[] = []): Promise<Client> {
  const client = new Client({ name: "flutter-medic-orchestrator", version: "0.0.1" });
  await client.connect(new StdioClientTransport({ command, args }));
  return client;
}

/**
 * Connects Dart MCP's DTD to the app instance rooted at `appPath`. Must happen
 * BEFORE the interaction steps run: get_runtime_errors only sees exceptions that
 * occur while actively connected, not a replayed history — connecting after the
 * fact silently misses everything.
 */
async function connectDartMcpToApp(dartMcp: Client, appPath: string): Promise<boolean> {
  await dartMcp.callTool({ name: "roots", arguments: { command: "add", uris: [`file://${appPath}`] } });
  const listing = toolText(await dartMcp.callTool({ name: "dtd", arguments: { command: "listDtdUris" } }));

  const escapedPath = appPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blocks = listing.split(/\n\n+/);
  const block = blocks.find((b) => new RegExp(`Workspace Root:\\s+${escapedPath}\\s*$`, "m").test(b));
  const uriMatch = block?.match(/WS URI:\s+(\S+)/);
  if (!uriMatch) {
    return false; // no DTD instance found for this app yet
  }

  await dartMcp.callTool({ name: "dtd", arguments: { command: "connect", uri: uriMatch[1] } });
  return true;
}

async function getRuntimeErrors(dartMcp: Client): Promise<string> {
  return toolText(await dartMcp.callTool({ name: "get_runtime_errors", arguments: { clearRuntimeErrors: true } }));
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
  params: InvestigateParams,
): Promise<RunResult> {
  // Dart MCP must already be connected (before the steps run) so it's actively
  // listening when any exception fires — see connectDartMcpToApp's docstring.
  await runInteractionSteps(marionette, params.steps);

  // Let navigation and any async work triggered by the steps settle.
  await new Promise((r) => setTimeout(r, 800));

  const interactiveElements = toolText(await marionette.callTool({ name: "get_interactive_elements" }));
  const runtimeErrors = await getRuntimeErrors(dartMcp);

  const signals: AnomalySignal[] = [];
  const exceptionSignal = detectRuntimeException(runtimeErrors);
  if (exceptionSignal) signals.push(exceptionSignal);

  if (params.expectedElementKey) {
    const missingSignal = detectMissingExpectedElement(interactiveElements, params.expectedElementKey);
    if (missingSignal) signals.push(missingSignal);
  }

  return { anomalyDetected: signals.length > 0, signals, interactiveElements };
}

export async function runInvestigation(params: InvestigateParams): Promise<EvidenceReport> {
  const appProcess = launchApp(params.deviceId, params.appPath);
  const vmServiceUri = await waitForVmServiceUri(appProcess);

  const marionette = await connectStdioClient(MARIONETTE_MCP_BIN);
  await marionette.callTool({ name: "connect", arguments: { uri: vmServiceUri } });

  const dartMcp = await connectStdioClient("dart", ["mcp-server"]);
  await connectDartMcpToApp(dartMcp, params.appPath);

  const runs: RunResult[] = [];
  for (let i = 0; i < REPRODUCTION_RUNS; i++) {
    runs.push(await runInvestigationOnce(marionette, dartMcp, params));
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
    reproductionCount,
    reproductionRuns: REPRODUCTION_RUNS,
    verdict: reproductionCount === REPRODUCTION_RUNS ? "confirmed" : "not-reproduced",
    runs,
  };

  await marionette.close();
  await dartMcp.close();
  appProcess.kill();
  return report;
}

// CLI entry point — only runs when this file is executed directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [deviceId, appPath] = process.argv.slice(2);
  if (!deviceId || !appPath) {
    console.error("Usage: investigate <device-id> <app-path>");
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
