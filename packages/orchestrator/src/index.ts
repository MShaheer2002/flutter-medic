import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { runInvestigation } from "./investigate.js";
import {
  closeApp,
  doubleTap,
  enterText,
  getLogs,
  hotReload,
  hotRestart,
  launchAppSession,
  longPress,
  observe,
  pinchZoom,
  pressBackButton,
  pressKey,
  reproduce,
  scrollTo,
  secondaryTap,
  swipe,
  takeScreenshots,
  tap,
} from "./session.js";

const server = new McpServer({ name: "flutter-medic", version: "0.0.1" });

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// Shared by every gesture tool that targets an element the way Marionette
// itself does: exactly one of key / text / type / coordinates.
const matcherSchema = {
  key: z.string().optional().describe("The widget's ValueKey — prefer this when known"),
  text: z.string().optional().describe("The element's visible text content"),
  type: z.string().optional().describe('The widget\'s Flutter type name (e.g. "ListTile")'),
  coordinates: z
    .object({ x: z.number(), y: z.number() })
    .optional()
    .describe("Screen coordinates, if no other selector applies"),
};

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

server.registerTool(
  "double_tap",
  {
    title: "Double-tap a widget",
    description: "Double-taps the matched element — text selection, zoom, or anything responding to double tap.",
    inputSchema: { ...matcherSchema, delay: z.number().optional().describe("Time between taps in ms (default 100)") },
  },
  async ({ delay, ...matcher }) => textResult(await doubleTap(matcher, delay)),
);

server.registerTool(
  "long_press",
  {
    title: "Long-press (hold) a widget",
    description: "Holds a press on the matched element — context menus, reorderable lists, etc.",
    inputSchema: {
      ...matcherSchema,
      duration: z.number().optional().describe("How long to hold, in ms (default 600)"),
    },
  },
  async ({ duration, ...matcher }) => textResult(await longPress(matcher, duration)),
);

server.registerTool(
  "secondary_tap",
  {
    title: "Secondary-tap (right-click) a widget",
    description: "Desktop only. Dispatches a right-button pointer event — for onSecondaryTap / context menus.",
    inputSchema: matcherSchema,
  },
  async (matcher) => textResult(await secondaryTap(matcher)),
);

server.registerTool(
  "swipe",
  {
    title: "Swipe or drag",
    description:
      "Element-based: key/text + direction (+ optional distance). Or coordinate-based: startX/startY/endX/endY " +
      "together, for exact control. For PageView, Dismissible, Drawer, Slider, and similar swipe-based widgets.",
    inputSchema: {
      key: z.string().optional(),
      text: z.string().optional(),
      direction: z.enum(["left", "right", "up", "down"]).optional(),
      distance: z.number().optional().describe("Pixels, element-based mode only (default 200)"),
      startX: z.number().optional(),
      startY: z.number().optional(),
      endX: z.number().optional(),
      endY: z.number().optional(),
    },
  },
  async (params) => textResult(await swipe(params)),
);

server.registerTool(
  "pinch_zoom",
  {
    title: "Pinch-zoom a widget",
    description: "Pinch gesture on the matched element — maps, images, PDFs, anything zoomable.",
    inputSchema: {
      ...matcherSchema,
      scale: z.number().describe("> 1.0 zooms in, < 1.0 zooms out"),
      startDistance: z.number().optional().describe("Initial finger distance in pixels (default 200)"),
    },
  },
  async ({ scale, startDistance, ...matcher }) => textResult(await pinchZoom(matcher, scale, startDistance)),
);

server.registerTool(
  "scroll_to",
  {
    title: "Scroll until an element is visible",
    description: "Scrolls the view until the element matching key or text becomes visible.",
    inputSchema: {
      key: z.string().optional().describe("The widget's ValueKey"),
      text: z.string().optional().describe("The element's visible text content"),
    },
  },
  async ({ key, text }) => textResult(await scrollTo(key, text)),
);

server.registerTool(
  "press_back_button",
  {
    title: "Press the system back button",
    description: "Android back / iOS swipe-back. Pops the current route if there's one to pop.",
    inputSchema: {},
  },
  async () => textResult(await pressBackButton()),
);

server.registerTool(
  "press_key",
  {
    title: "Press a keyboard key",
    description:
      "Sends a real key event through the focus system (unlike enter_text, which just replaces a field's " +
      "value) — submit with enter, move focus with tab, dismiss with escape, edit with backspace/arrows, or " +
      "trigger shortcuts via modifiers. Sent to whatever currently has focus — tap a target first if needed.",
    inputSchema: {
      key: z
        .string()
        .describe(
          "enter, tab, escape, backspace, delete, space, arrowUp/Down/Left/Right, home, end, pageUp, pageDown, or a single a-z/0-9 character",
        ),
      modifiers: z
        .string()
        .optional()
        .describe('Comma-separated: control, shift, alt, meta (e.g. "control,shift")'),
    },
  },
  async ({ key, modifiers }) => textResult(await pressKey(key, modifiers)),
);

server.registerTool(
  "take_screenshots",
  {
    title: "Take screenshots",
    description: "Captures the current visual state of every view in the app as PNG images.",
    inputSchema: {},
  },
  async () => textResult(await takeScreenshots()),
);

server.registerTool(
  "get_logs",
  {
    title: "Get Marionette's app logs",
    description:
      "Marionette's own collected app logs since launch or the last hot reload — separate from observe()'s " +
      "VM-service/native-log evidence. Needs a marionette_logging/marionette_logger adapter wired into the " +
      "target app to work; errors with setup instructions otherwise.",
    inputSchema: {},
  },
  async () => textResult(await getLogs()),
);

server.registerTool(
  "hot_reload",
  {
    title: "Hot reload the app",
    description: "Reloads Dart code without restarting — preserves current state, unlike hot_restart.",
    inputSchema: {},
  },
  async () => textResult(await hotReload()),
);

const transport = new StdioServerTransport();
await server.connect(transport);
