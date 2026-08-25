import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The command every agent gets registered with — the published, no-clone
// path (§14). init itself is meant to be run via `npx flutter-medic init`,
// so the registration it writes should be equally portable, not a path
// into whatever local checkout init happened to run from.
const REGISTER_COMMAND = "npx";
const REGISTER_ARGS = ["-y", "flutter-medic"];

/** Works for both files and directories — readFile alone throws EISDIR on a directory that DOES exist. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** ENOENT means the binary itself doesn't exist; any other failure (e.g. a non-zero exit) still means it's installed. */
async function commandExists(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

async function findFlutterProjectRoot(startDir: string): Promise<string> {
  let dir = startDir;
  while (true) {
    try {
      const content = await readFile(join(dir, "pubspec.yaml"), "utf-8");
      if (/^\s*flutter\s*:/m.test(content)) return dir;
    } catch {
      // no pubspec.yaml here — keep looking upward
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "No Flutter project found (no pubspec.yaml with a flutter: section, here or in any parent directory). Run `flutter-medic init` from inside your Flutter project.",
      );
    }
    dir = parent;
  }
}

interface RegisterResult {
  ok: boolean;
  detail: string;
}

async function runCli(command: string, args: string[]): Promise<RegisterResult> {
  try {
    const { stdout } = await execFileAsync(command, args);
    return { ok: true, detail: stdout.trim() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Already-registered is a soft outcome, not a real failure — don't make
    // re-running init on an already-set-up machine look like something broke.
    if (/already exists|already registered|already added/i.test(message)) {
      return { ok: true, detail: "already registered" };
    }
    return { ok: false, detail: message.split("\n")[0] };
  }
}

/**
 * Cursor has no CLI-add command (confirmed gap, doc/research) — the only
 * supported paths are its GUI or hand-editing .cursor/mcp.json. Only
 * auto-merges into a file that's missing or already valid JSON; if it
 * exists but fails to parse, refuses to touch it rather than risk
 * clobbering content we can't understand.
 */
async function registerCursor(): Promise<RegisterResult> {
  const configPath = join(homedir(), ".cursor", "mcp.json");
  let config: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };

  if (await pathExists(configPath)) {
    try {
      config = JSON.parse(await readFile(configPath, "utf-8"));
    } catch {
      return { ok: false, detail: `${configPath} exists but isn't valid JSON — won't risk overwriting it` };
    }
  }

  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers["flutter-medic"] = { command: REGISTER_COMMAND, args: REGISTER_ARGS };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return { ok: true, detail: configPath };
}

/** `dart pub global activate` is idempotent — re-running init on an already-set-up machine is a safe no-op. */
async function ensureMarionetteMcpInstalled(): Promise<RegisterResult> {
  try {
    await execFileAsync("dart", ["pub", "global", "activate", "marionette_mcp"]);
    return { ok: true, detail: "device bridge installed/up to date" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: message.split("\n")[0] };
  }
}

/**
 * Depends on flutter_medic_bridge (our own thin wrapper around
 * marionette_flutter, published separately) rather than marionette_flutter
 * directly, so the target app's own pubspec.yaml/main.dart never say
 * "marionette" — the only two files a developer would ever actually open.
 * Added under `dependencies`, not `dev_dependencies`: it's imported from
 * main.dart, real app source, not test-only code — confirmed live via
 * `flutter analyze`, which flags a dev_dependency imported from lib/ with
 * the `depend_on_referenced_packages` lint.
 */
async function ensureBridgeInPubspec(root: string): Promise<RegisterResult> {
  const pubspecPath = join(root, "pubspec.yaml");
  const content = await readFile(pubspecPath, "utf-8");

  if (/^\s*flutter_medic_bridge\s*:/m.test(content)) {
    return { ok: true, detail: "already in pubspec.yaml" };
  }

  const patched = /^dependencies:\s*$/m.test(content)
    ? content.replace(/^dependencies:\s*$/m, "dependencies:\n  flutter_medic_bridge: ^0.1.0")
    : content.trimEnd() + "\n\ndependencies:\n  flutter_medic_bridge: ^0.1.0\n";

  await writeFile(pubspecPath, patched, "utf-8");
  return { ok: true, detail: "added flutter-medic's device bridge to pubspec.yaml" };
}

/**
 * Wires in flutter_medic_bridge (never marionette_flutter directly — see
 * ensureBridgeInPubspec). Only auto-patches a narrow, near-universal pattern: a bare
 * `WidgetsFlutterBinding.ensureInitialized();` line, standing alone. Verified
 * against a real, non-trivial app's main.dart (async main(), Firebase/Stripe/
 * dotenv init, MultiProvider) — that line is there verbatim regardless of
 * everything else going on around it. Replacing it with the kDebugMode-guarded
 * version leaves release/profile builds calling the exact same original line,
 * so this can't change production behavior. Anything that doesn't match this
 * exact shape falls back to manual instructions rather than guessing.
 */
async function patchMainDart(root: string): Promise<RegisterResult> {
  const mainDartPath = join(root, "lib", "main.dart");
  let content: string;
  try {
    content = await readFile(mainDartPath, "utf-8");
  } catch {
    return { ok: false, detail: "lib/main.dart not found" };
  }

  if (content.includes("flutter_medic_bridge") || content.includes("FlutterMedicBridge")) {
    return { ok: true, detail: "already wired" };
  }

  const bindingLine = /^([ \t]*)WidgetsFlutterBinding\.ensureInitialized\(\);[ \t]*$/m;
  const match = content.match(bindingLine);
  if (!match) {
    return {
      ok: false,
      detail: "couldn't find a bare `WidgetsFlutterBinding.ensureInitialized();` line to safely replace",
    };
  }

  const indent = match[1];
  const replacement =
    `${indent}if (kDebugMode) {\n` +
    `${indent}  FlutterMedicBridge.ensureInitialized();\n` +
    `${indent}} else {\n` +
    `${indent}  WidgetsFlutterBinding.ensureInitialized();\n` +
    `${indent}}`;
  let patched = content.replace(bindingLine, replacement);

  const imports = [`import 'package:flutter_medic_bridge/flutter_medic_bridge.dart';`];
  if (!patched.includes("package:flutter/foundation.dart")) {
    imports.push(`import 'package:flutter/foundation.dart';`);
  }
  const importLines = [...patched.matchAll(/^import\s+['"][^'"]+['"];?\s*$/gm)];
  if (importLines.length > 0) {
    const last = importLines[importLines.length - 1];
    const at = last.index! + last[0].length;
    const rest = patched.slice(at);
    const separator = rest.startsWith("\n\n") ? "\n" : "\n\n";
    patched = patched.slice(0, at) + "\n" + imports.join("\n") + separator + rest.replace(/^\n+/, "");
  } else {
    patched = imports.join("\n") + "\n\n" + patched;
  }

  await writeFile(mainDartPath, patched, "utf-8");
  return { ok: true, detail: "wired flutter-medic's device bridge into lib/main.dart — review the diff" };
}

interface AgentSpec {
  name: string;
  check: () => Promise<boolean>;
  register: () => Promise<RegisterResult>;
  manualInstructions: string;
}

const AGENTS: AgentSpec[] = [
  {
    name: "Claude Code",
    check: () => commandExists("claude", ["--version"]),
    register: () =>
      runCli("claude", ["mcp", "add", "flutter-medic", "-s", "local", "--", REGISTER_COMMAND, ...REGISTER_ARGS]),
    manualInstructions: `claude mcp add flutter-medic -s local -- ${REGISTER_COMMAND} ${REGISTER_ARGS.join(" ")}`,
  },
  {
    name: "Gemini CLI",
    check: () => commandExists("gemini", ["--version"]),
    register: () => runCli("gemini", ["mcp", "add", "flutter-medic", REGISTER_COMMAND, ...REGISTER_ARGS]),
    manualInstructions: `gemini mcp add flutter-medic ${REGISTER_COMMAND} -- ${REGISTER_ARGS.join(" ")}`,
  },
  {
    name: "Codex CLI",
    check: () => commandExists("codex", ["--version"]),
    register: () => runCli("codex", ["mcp", "add", "flutter-medic", "--", REGISTER_COMMAND, ...REGISTER_ARGS]),
    manualInstructions: `codex mcp add flutter-medic -- ${REGISTER_COMMAND} ${REGISTER_ARGS.join(" ")}`,
  },
  {
    name: "Cursor",
    check: () => pathExists(join(homedir(), ".cursor")),
    register: registerCursor,
    manualInstructions: `Add to ~/.cursor/mcp.json:\n${JSON.stringify(
      { mcpServers: { "flutter-medic": { command: REGISTER_COMMAND, args: REGISTER_ARGS } } },
      null,
      2,
    )}`,
  },
];

/**
 * With more than one agent detected, ask which to register with rather than
 * silently registering all of them — found live (a real user's own report):
 * detecting three agents and registering all three without asking is
 * surprising, not helpful, if the user only actually uses one of them.
 * Auto-proceeds without asking when there's exactly one candidate — nothing
 * to actually choose between.
 */
async function promptForAgents(detected: AgentSpec[]): Promise<AgentSpec[]> {
  console.log("\nMultiple AI agents found. Register flutter-medic with which one(s)?");
  detected.forEach((agent, i) => console.log(`  [${i + 1}] ${agent.name}`));
  console.log("  [a] All");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Choose (e.g. "1", "1,3", or "a"): ')).trim().toLowerCase();
  rl.close();

  if (answer === "a" || answer === "all" || answer === "") return detected;

  const chosen = answer
    .split(",")
    .map((s) => detected[parseInt(s.trim(), 10) - 1])
    .filter((agent): agent is AgentSpec => agent !== undefined);

  if (chosen.length === 0) {
    console.log("No valid selection understood — registering with all detected agents.");
    return detected;
  }
  return chosen;
}

/**
 * `npx flutter-medic init`, run from a Flutter project root. Detects the
 * project and which supported AI agents are installed, asks which to
 * register with if more than one was found, and registers flutter-medic
 * with each chosen one — the single-command setup path, no cloning this
 * repo required. Never touches an agent it can't confirm is actually
 * installed, and never silently overwrites a config file it can't safely
 * parse.
 */
export async function runInit(projectPath: string = process.cwd()): Promise<void> {
  const root = await findFlutterProjectRoot(projectPath);
  console.log(`Flutter project found: ${root}`);

  console.log("\nSetting up flutter-medic's device bridge in this app...");
  const bridgeSteps: [string, RegisterResult][] = [
    ["Device bridge tooling", await ensureMarionetteMcpInstalled()],
    ["App dependency", await ensureBridgeInPubspec(root)],
    ["App wiring", await patchMainDart(root)],
  ];
  for (const [label, result] of bridgeSteps) {
    console.log(result.ok ? `  ${label}: ${result.detail}.` : `  ${label}: skipped — ${result.detail}.`);
  }
  if (bridgeSteps.some(([, r]) => !r.ok)) {
    console.log("  Some steps need a manual touch — see the README's Installing section.");
  }

  const detected: AgentSpec[] = [];
  for (const agent of AGENTS) {
    if (await agent.check()) detected.push(agent);
  }

  if (detected.length === 0) {
    throw new Error(
      "No supported AI agent found (checked Claude Code, Gemini CLI, Codex CLI, Cursor). Install one, or register flutter-medic manually.",
    );
  }

  console.log(`Found: ${detected.map((a) => a.name).join(", ")}`);
  const toRegister = detected.length === 1 ? detected : await promptForAgents(detected);

  let anyRegistered = false;
  for (const agent of toRegister) {
    const result = await agent.register();
    if (result.ok) {
      console.log(`${agent.name}: registered (${result.detail}).`);
      anyRegistered = true;
    } else {
      console.log(`${agent.name}: could not register automatically — ${result.detail}`);
      console.log(`  Manual: ${agent.manualInstructions}`);
    }
  }

  if (anyRegistered) {
    console.log("\nRestart your AI agent — new MCP tools only appear after a fresh session starts.");
  }
}
