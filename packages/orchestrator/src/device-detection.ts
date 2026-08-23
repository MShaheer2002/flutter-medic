import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  const { stdout } = await execFileAsync("flutter", ["devices", "--machine"]);
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
