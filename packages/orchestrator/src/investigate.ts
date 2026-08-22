import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Hardcoded Phase 1 investigation: proves the mechanical OBSERVE -> ACT -> OBSERVE
// -> reproduce -> report pipeline against the killer-demo app's known bug.
// No NL planning, no LLM anomaly judgment — that's Phase 2+. This only checks the
// one specific condition the killer-demo app is built to trigger (§12.1 of the spec).
const KILLER_DEMO_APP_PATH = join(
  import.meta.dirname,
  "../../../examples/killer_demo_app",
);
const MARIONETTE_MCP_BIN = join(homedir(), ".pub-cache/bin/marionette_mcp");
const REPRODUCTION_RUNS = 3;

export interface RunResult {
  anomalyDetected: boolean;
  interactiveElements: string;
}

export interface EvidenceReport {
  goal: string;
  reproductionCount: number;
  reproductionRuns: number;
  verdict: "confirmed" | "not-reproduced";
  runs: RunResult[];
}

function launchApp(deviceId: string): ChildProcessWithoutNullStreams {
  return spawn("flutter", ["run", "-d", deviceId, "--debug"], {
    cwd: KILLER_DEMO_APP_PATH,
  });
}

function waitForVmServiceUri(proc: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/A Dart VM Service .* is available at: (http:\/\/[^\s]+)/);
      if (match) {
        proc.stdout.off("data", onData);
        const wsUri = match[1].replace("http://", "ws://") + "ws";
        resolve(wsUri);
      }
    };
    proc.stdout.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`flutter run exited early (code ${code})`)));
  });
}

async function connectMarionette(): Promise<Client> {
  const client = new Client({ name: "flutter-medic-orchestrator", version: "0.0.1" });
  const transport = new StdioClientTransport({ command: MARIONETTE_MCP_BIN });
  await client.connect(transport);
  return client;
}

async function runInvestigationOnce(marionette: Client): Promise<RunResult> {
  await marionette.callTool({
    name: "enter_text",
    arguments: { key: "email_field", input: "dev@flutter-medic.test" },
  });
  await marionette.callTool({
    name: "enter_text",
    arguments: { key: "password_field", input: "hunter2" },
  });
  await marionette.callTool({
    name: "tap",
    arguments: { key: "login_button" },
  });

  // Give the navigation + fake API delay (400ms in task_api.dart) time to settle.
  await new Promise((r) => setTimeout(r, 800));

  const elementsResult = await marionette.callTool({ name: "get_interactive_elements" });
  const content = (elementsResult as { content: Array<{ type: string; text?: string }> }).content;
  const elementsText = content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");

  // Tier-1 anomaly rule (hardcoded for this known app, not yet a general rule):
  // "empty_tasks_message" present + "tasks_list" absent means the fetch completed
  // but the widget never rendered the result.
  const anomalyDetected =
    elementsText.includes("empty_tasks_message") && !elementsText.includes("tasks_list");

  return { anomalyDetected, interactiveElements: elementsText };
}

export async function runInvestigation(deviceId: string): Promise<EvidenceReport> {
  const appProcess = launchApp(deviceId);
  const vmServiceUri = await waitForVmServiceUri(appProcess);

  const marionette = await connectMarionette();
  await marionette.callTool({ name: "connect", arguments: { uri: vmServiceUri } });

  const runs: RunResult[] = [];
  for (let i = 0; i < REPRODUCTION_RUNS; i++) {
    runs.push(await runInvestigationOnce(marionette));
    if (i < REPRODUCTION_RUNS - 1) {
      await marionette.callTool({ name: "hot_restart" });
      await new Promise((r) => setTimeout(r, 1500)); // let the restarted app settle
    }
  }

  const reproductionCount = runs.filter((r) => r.anomalyDetected).length;
  const report: EvidenceReport = {
    goal: "Verify tasks appear on Home after login; find out why if they don't.",
    reproductionCount,
    reproductionRuns: REPRODUCTION_RUNS,
    verdict: reproductionCount === REPRODUCTION_RUNS ? "confirmed" : "not-reproduced",
    runs,
  };

  appProcess.kill();
  return report;
}

// CLI entry point — only runs when this file is executed directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  const deviceId = process.argv[2];
  if (!deviceId) {
    console.error("Usage: investigate <device-id>");
    process.exit(1);
  }

  runInvestigation(deviceId)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.verdict === "confirmed" ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
