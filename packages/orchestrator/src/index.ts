import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { runInvestigation } from "./investigate.js";

const server = new McpServer({ name: "flutter-medic", version: "0.0.1" });

server.registerTool(
  "investigate",
  {
    title: "Investigate a Flutter app",
    description:
      "Launches a Flutter app and runs the given interaction steps, checking for " +
      "tier-1 anomaly signals (a runtime exception, or an expected widget that " +
      "never appeared). Reproduces the flow 3x before reporting. Works against " +
      "any Flutter project — the caller supplies the steps and, optionally, what " +
      "widget key it expects to see afterward. No NL planning or LLM judgment " +
      "yet: the caller must already know what to tap and what to expect. If " +
      "deviceId is omitted, auto-detects the single connected physical Android " +
      "device — errors if there's none or more than one.",
    inputSchema: {
      deviceId: z
        .string()
        .optional()
        .describe("Device ID from `flutter devices` / `adb devices`. Auto-detected if omitted."),
      appPath: z.string().describe("Absolute path to the Flutter project to investigate"),
      goal: z.string().describe("Human-readable description of what's being verified"),
      steps: z
        .array(
          z.object({
            action: z.enum(["tap", "enter_text"]),
            key: z.string().describe("The widget's ValueKey"),
            input: z.string().optional().describe("Required for enter_text"),
          }),
        )
        .describe("Interaction steps to reach the state worth observing"),
      expectedElementKey: z
        .string()
        .optional()
        .describe("If given, its absence after the steps run is treated as an anomaly"),
    },
  },
  async ({ deviceId, appPath, goal, steps, expectedElementKey }) => {
    const report = await runInvestigation({ deviceId, appPath, goal, steps, expectedElementKey });
    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
