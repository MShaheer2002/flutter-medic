import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
 * clobbering content we can't understand — the caller falls back to
 * printing manual instructions in that case.
 */
async function registerCursor(): Promise<{ configPath: string; autoRegistered: boolean }> {
  const configPath = join(homedir(), ".cursor", "mcp.json");
  let config: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };

  if (await pathExists(configPath)) {
    try {
      config = JSON.parse(await readFile(configPath, "utf-8"));
    } catch {
      return { configPath, autoRegistered: false };
    }
  }

  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers["flutter-medic"] = { command: REGISTER_COMMAND, args: REGISTER_ARGS };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return { configPath, autoRegistered: true };
}

interface AgentSpec {
  name: string;
  check: () => Promise<boolean>;
  register: () => Promise<RegisterResult>;
  manualCommand: string;
}

const CLI_AGENTS: AgentSpec[] = [
  {
    name: "Claude Code",
    check: () => commandExists("claude", ["--version"]),
    register: () =>
      runCli("claude", ["mcp", "add", "flutter-medic", "-s", "local", "--", REGISTER_COMMAND, ...REGISTER_ARGS]),
    manualCommand: `claude mcp add flutter-medic -s local -- ${REGISTER_COMMAND} ${REGISTER_ARGS.join(" ")}`,
  },
  {
    name: "Gemini CLI",
    check: () => commandExists("gemini", ["--version"]),
    register: () => runCli("gemini", ["mcp", "add", "flutter-medic", REGISTER_COMMAND, ...REGISTER_ARGS]),
    manualCommand: `gemini mcp add flutter-medic ${REGISTER_COMMAND} -- ${REGISTER_ARGS.join(" ")}`,
  },
  {
    name: "Codex CLI",
    check: () => commandExists("codex", ["--version"]),
    register: () => runCli("codex", ["mcp", "add", "flutter-medic", "--", REGISTER_COMMAND, ...REGISTER_ARGS]),
    manualCommand: `codex mcp add flutter-medic -- ${REGISTER_COMMAND} ${REGISTER_ARGS.join(" ")}`,
  },
];

/**
 * `npx flutter-medic init`, run from a Flutter project root. Detects the
 * project, detects which supported AI agents are installed, and registers
 * flutter-medic with each one automatically — the single-command setup
 * path, no cloning this repo required. Never touches an agent it can't
 * confirm is actually installed, and never silently overwrites a config
 * file it can't safely parse.
 */
export async function runInit(projectPath: string = process.cwd()): Promise<void> {
  const root = await findFlutterProjectRoot(projectPath);
  console.log(`Flutter project found: ${root}`);

  let anyDetected = false;
  let anyRegistered = false;

  for (const agent of CLI_AGENTS) {
    if (!(await agent.check())) continue;
    anyDetected = true;
    console.log(`${agent.name} detected.`);
    const result = await agent.register();
    if (result.ok) {
      console.log(`  Registered flutter-medic (${result.detail}).`);
      anyRegistered = true;
    } else {
      console.log(`  Could not register automatically: ${result.detail}`);
      console.log(`  Run manually: ${agent.manualCommand}`);
    }
  }

  if (await pathExists(join(homedir(), ".cursor"))) {
    anyDetected = true;
    console.log("Cursor detected.");
    const { configPath, autoRegistered } = await registerCursor();
    if (autoRegistered) {
      console.log(`  Registered flutter-medic in ${configPath}.`);
      anyRegistered = true;
    } else {
      console.log(`  ${configPath} exists but isn't valid JSON — won't risk overwriting it. Add this manually:`);
      console.log(
        JSON.stringify(
          { mcpServers: { "flutter-medic": { command: REGISTER_COMMAND, args: REGISTER_ARGS } } },
          null,
          2,
        ),
      );
    }
  }

  if (!anyDetected) {
    throw new Error(
      "No supported AI agent found (checked Claude Code, Gemini CLI, Codex CLI, Cursor). Install one, or register flutter-medic manually.",
    );
  }

  if (anyRegistered) {
    console.log("\nRestart your AI agent — new MCP tools only appear after a fresh session starts.");
  }
}
