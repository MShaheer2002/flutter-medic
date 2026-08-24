import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);

export const MARIONETTE_MCP_BIN = join(homedir(), ".pub-cache/bin/marionette_mcp");

export function launchApp(deviceId: string, appPath: string): ChildProcessWithoutNullStreams {
  return spawn("flutter", ["run", "-d", deviceId, "--debug"], { cwd: appPath });
}

/**
 * Killing the local `flutter run` wrapper process doesn't reliably stop the
 * app on the device itself — force-stop it explicitly so a stale instance
 * doesn't linger and confuse the next run.
 */
export async function forceStopApp(deviceId: string, applicationId: string): Promise<void> {
  await execFileAsync("adb", ["-s", deviceId, "shell", "am", "force-stop", applicationId]).catch(() => {});
}

export function waitForVmServiceUri(proc: ChildProcessWithoutNullStreams): Promise<string> {
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

export function toolText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
}

export async function connectStdioClient(command: string, args: string[] = []): Promise<Client> {
  const client = new Client({ name: "flutter-medic-orchestrator", version: "0.0.1" });
  await client.connect(new StdioClientTransport({ command, args }));
  return client;
}

/**
 * Connects Dart MCP's DTD to the app instance rooted at `appPath`. Must happen
 * BEFORE anything you want get_runtime_errors to see, not after: it only
 * captures exceptions that occur while actively connected, not a replayed
 * history — connecting after the fact silently misses everything (doc/007).
 */
export async function connectDartMcpToApp(dartMcp: Client, appPath: string): Promise<boolean> {
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

  // Must be enabled before any HTTP request we want profiled fires — same
  // "enable before the fact happens" gap as get_runtime_errors (doc/007).
  // Best-effort: enrichment evidence, not core functionality, so an older SDK
  // or a non-Flutter isolate must not break the connect flow.
  await enableHttpProfiling(dartMcp, await getMainIsolateId(dartMcp)).catch(() => {});
  return true;
}

export async function getRuntimeErrors(dartMcp: Client): Promise<string> {
  return toolText(await dartMcp.callTool({ name: "get_runtime_errors", arguments: { clearRuntimeErrors: true } }));
}

/**
 * HTTP profiling extension RPCs are per-isolate, so a fresh isolate ID (from
 * `main()` running, and again after every hot_restart) is required before
 * they'll work.
 */
export async function getMainIsolateId(dartMcp: Client): Promise<string> {
  const raw = toolText(await dartMcp.callTool({ name: "vm_service", arguments: { command: "callMethod", method: "getVM" } }));
  const vm = JSON.parse(raw) as { isolates?: Array<{ id: string }> };
  const id = vm.isolates?.[0]?.id;
  if (!id) throw new Error("No isolate found on connected VM");
  return id;
}

/**
 * Must be enabled BEFORE the HTTP request fires, or it's silently missed —
 * same "enable before the fact happens" gap as get_runtime_errors (doc/007).
 * Only works against a real Flutter-embedded isolate, not a bare Dart CLI
 * process (doc/015).
 */
export async function enableHttpProfiling(dartMcp: Client, isolateId: string): Promise<void> {
  await dartMcp.callTool({
    name: "vm_service",
    arguments: { command: "callMethod", method: "ext.dart.io.httpEnableTimelineLogging", isolateId, arguments: { enabled: true } },
  });
}

function decodeBodyBytes(bytes: unknown): string | undefined {
  if (!Array.isArray(bytes) || bytes.length === 0) return undefined;
  try {
    return Buffer.from(bytes as number[]).toString("utf-8");
  } catch {
    return undefined;
  }
}

/**
 * `ext.dart.io.getHttpProfile` only returns metadata (status, headers,
 * timing) — never the actual request/response body content, which needs a
 * separate per-request `ext.dart.io.getHttpProfileRequest` call (confirmed
 * against vm_service's own source, doc/023). Enriches each completed
 * request in place with `requestBodyText`/`responseBodyText` so the
 * calling agent can actually see what data an API returned, not just that
 * it returned 200.
 */
export async function getNetworkActivity(dartMcp: Client): Promise<string> {
  try {
    const isolateId = await getMainIsolateId(dartMcp);
    const raw = toolText(
      await dartMcp.callTool({
        name: "vm_service",
        arguments: { command: "callMethod", method: "ext.dart.io.getHttpProfile", isolateId },
      }),
    );
    const profile = JSON.parse(raw) as { requests?: Array<Record<string, unknown>> };

    for (const request of profile.requests ?? []) {
      if (!request.response) continue; // still in flight — nothing to fetch yet
      try {
        const detailRaw = toolText(
          await dartMcp.callTool({
            name: "vm_service",
            arguments: {
              command: "callMethod",
              method: "ext.dart.io.getHttpProfileRequest",
              isolateId,
              arguments: { id: request.id },
            },
          }),
        );
        const detail = JSON.parse(detailRaw) as { requestBody?: unknown; responseBody?: unknown };
        const requestBodyText = decodeBodyBytes(detail.requestBody);
        const responseBodyText = decodeBodyBytes(detail.responseBody);
        if (requestBodyText) request.requestBodyText = requestBodyText.slice(0, 10000);
        if (responseBodyText) request.responseBodyText = responseBodyText.slice(0, 10000);
      } catch {
        // Best-effort — a missing body must not break the rest of the evidence.
      }
    }

    return JSON.stringify(profile);
  } catch {
    return "";
  }
}
