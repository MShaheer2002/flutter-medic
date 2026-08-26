import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Always the bare command, resolved via PATH exactly like typing `flutter`
 * in a terminal would — deliberately not version-manager-aware. Whether a
 * developer uses fvm, asdf, puro, homebrew, or a manually-installed SDK,
 * PATH is already how their own terminal picks a Flutter version; deferring
 * to it here means flutter-medic always matches that, with zero knowledge of
 * which tool (if any) put it there. Not something to special-case per tool.
 */
export const FLUTTER_BIN = "flutter";

/** Works the same regardless of what put `flutter` on PATH — the calling agent should always know which version it's driving. */
export async function getFlutterVersion(bin: string): Promise<string> {
  const { stdout } = await execFileAsync(bin, ["--version"]);
  return stdout.match(/Flutter (\S+)/)?.[1] ?? "unknown";
}

export type DevicePlatform = "android" | "ios";

export interface DetectedDevice {
  id: string;
  name: string;
  platform: DevicePlatform;
  isSimulator: boolean;
}

interface FlutterDevice {
  id: string;
  name: string;
  targetPlatform: string;
  emulator: boolean;
}

function toDetectedDevice(d: FlutterDevice): DetectedDevice {
  return {
    id: d.id,
    name: d.name,
    platform: d.targetPlatform.startsWith("ios") ? "ios" : "android",
    isSimulator: d.emulator,
  };
}

/**
 * Resolves the device to target. If `deviceId` is given, looks it up (so the
 * platform is always known — never assumed) and errors if it's not
 * currently connected. If omitted, auto-detects: a physical Android device,
 * or an iOS device/simulator (Phase 5, §13 — "simulator first, physical
 * device later", so iOS simulators are allowed candidates same as physical;
 * Android keeps its original physical-only scope from Phase 1, §12).
 * Errors clearly rather than guessing on zero or multiple matches — picking
 * the wrong device silently is worse than asking the caller to be explicit.
 */
export async function resolveDevice(deviceId?: string): Promise<DetectedDevice> {
  const { stdout } = await execFileAsync(FLUTTER_BIN, ["devices", "--machine"]);
  const devices: FlutterDevice[] = JSON.parse(stdout);

  if (deviceId) {
    const match = devices.find((d) => d.id === deviceId);
    if (!match) {
      throw new Error(`Device "${deviceId}" not found among currently connected devices.`);
    }
    return toDetectedDevice(match);
  }

  const candidates = devices.filter(
    (d) => (d.targetPlatform.startsWith("android") && !d.emulator) || d.targetPlatform.startsWith("ios"),
  );

  if (candidates.length === 0) {
    throw new Error(
      "No physical Android device or iOS device/simulator found. Connect one, boot a simulator, or pass deviceId explicitly.",
    );
  }
  if (candidates.length > 1) {
    const list = candidates.map((d) => `${d.id} (${d.name})`).join(", ");
    throw new Error(`Multiple devices found: ${list}. Pass deviceId explicitly to pick one.`);
  }

  return toDetectedDevice(candidates[0]);
}
