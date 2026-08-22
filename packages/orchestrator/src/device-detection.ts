import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface FlutterDevice {
  id: string;
  name: string;
  targetPlatform: string;
  emulator: boolean;
}

/**
 * Auto-detects a physical Android device, matching the MVP's Android-only,
 * physical-device-first scope (§12). Errors clearly rather than guessing when
 * there's zero or more than one match — picking the wrong device silently is
 * worse than asking the caller to be explicit.
 */
export async function detectAndroidDevice(): Promise<{ id: string; name: string }> {
  const { stdout } = await execFileAsync("flutter", ["devices", "--machine"]);
  const devices: FlutterDevice[] = JSON.parse(stdout);
  const candidates = devices.filter((d) => d.targetPlatform.startsWith("android") && !d.emulator);

  if (candidates.length === 0) {
    throw new Error(
      "No physical Android device found. Connect one over USB with debugging enabled, or pass deviceId explicitly.",
    );
  }
  if (candidates.length > 1) {
    const list = candidates.map((d) => `${d.id} (${d.name})`).join(", ");
    throw new Error(`Multiple physical Android devices found: ${list}. Pass deviceId explicitly to pick one.`);
  }

  return { id: candidates[0].id, name: candidates[0].name };
}
