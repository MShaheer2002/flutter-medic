import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { runInvestigation } from "./investigate.js";
import { closeApp, enterText, hotRestart, launchAppSession, observe, reproduce, tap } from "./session.js";

const server = new McpServer({ name: "flutter-medic", version: "0.0.1" });

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  "investigate",
  {
    title: "Investigate a Flutter app",
    description:
      "Launches a Flutter app fresh and runs the given interaction steps, checking " +
      "for tier-1 anomaly signals (a runtime exception, or an expected widget that " +
      "never appeared). Reproduces the flow 3x before reporting, then closes the " +
      "app. Works against any Flutter project — the caller supplies the steps and, " +
      "optionally, what widget key it expects to see afterward. Best when you " +
      "already know exactly what to do and check and don't have a session open " +
      "yet. If you've already explored with launch_app, use reproduce instead — " +
      "it verifies against the app that's already running, without a full " +
      "terminate-and-relaunch. If deviceId is omitted, auto-detects the single " +
      "connected physical Android device — errors if there's none or more than one.",
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
    return textResult(report);
  },
);

server.registerTool(
  "launch_app",
  {
    title: "Launch a Flutter app for exploration",
    description:
      "Starts a Flutter app on a device and holds the connection open across " +
      "subsequent tool calls (tap, enter_text, observe, hot_restart), so you can " +
      "explore and plan step by step instead of pre-specifying every action up " +
      "front like investigate requires. Only one session at a time — call " +
      "close_app before launching another. If deviceId is omitted, auto-detects " +
      "the single connected physical Android device.",
    inputSchema: {
      appPath: z.string().describe("Absolute path to the Flutter project to launch"),
      deviceId: z.string().optional().describe("Device ID. Auto-detected if omitted."),
    },
  },
  async ({ appPath, deviceId }) => textResult(await launchAppSession(appPath, deviceId)),
);

server.registerTool(
  "close_app",
  {
    title: "Close the current app session",
    description: "Stops the app and releases the session opened by launch_app. Safe to call even if none is open.",
    inputSchema: {},
  },
  async () => textResult(await closeApp()),
);

server.registerTool(
  "tap",
  {
    title: "Tap a widget",
    description: "Taps the widget with the given ValueKey in the currently launched app.",
    inputSchema: { key: z.string().describe("The widget's ValueKey") },
  },
  async ({ key }) => textResult(await tap(key)),
);

server.registerTool(
  "enter_text",
  {
    title: "Enter text into a widget",
    description: "Types text into the text field with the given ValueKey in the currently launched app.",
    inputSchema: {
      key: z.string().describe("The widget's ValueKey"),
      input: z.string().describe("Text to type"),
    },
  },
  async ({ key, input }) => textResult(await enterText(key, input)),
);

server.registerTool(
  "observe",
  {
    title: "Observe the current app state",
    description:
      "Returns the widget tree, any VM-service-reported runtime exceptions, and any " +
      "native-log exceptions since the last observe call (or since launch_app, on " +
      "the first call). Raw evidence, no judgment applied — you decide what it means.",
    inputSchema: {},
  },
  async () => textResult(await observe()),
);

server.registerTool(
  "hot_restart",
  {
    title: "Hot restart the app",
    description: "Restarts the currently launched app from main(), resetting all state.",
    inputSchema: {},
  },
  async () => textResult(await hotRestart()),
);

server.registerTool(
  "reproduce",
  {
    title: "Reproduce and verify steps against the running app",
    description:
      "Runs the given steps against the app already open from launch_app, 3x, " +
      "hot-restarting between attempts, checking the same tier-1 anomaly signals " +
      "investigate does — but never terminates or relaunches the app, since it's " +
      "already running. Use this once exploration (observe/tap/enter_text) has " +
      "told you what to check; use investigate instead if you don't have a " +
      "session open yet.",
    inputSchema: {
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
  async ({ steps, expectedElementKey }) => textResult(await reproduce(steps, expectedElementKey)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
