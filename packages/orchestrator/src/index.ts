import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { runInvestigation } from "./investigate.js";

const server = new McpServer({ name: "flutter-medic", version: "0.0.1" });

server.registerTool(
  "investigate",
  {
    title: "Investigate the killer-demo app",
    description:
      "Launches the killer-demo app on the given device, logs in, checks whether " +
      "the known Home-screen task-loading bug reproduces, and returns a structured " +
      "evidence report. Phase 1: hardcoded to this one app and this one known bug " +
      "signature — not yet a general investigation tool.",
    inputSchema: {
      deviceId: z.string().describe("Device ID from `flutter devices` / `adb devices`"),
    },
  },
  async ({ deviceId }) => {
    const report = await runInvestigation(deviceId);
    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
