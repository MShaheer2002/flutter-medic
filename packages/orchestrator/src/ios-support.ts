import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Phase 5 (§13): "simulator first, physical device later". Everything here
// is simulator-only and UNTESTED — built without any device/simulator run
// against it (see doc/020). Physical iOS support needs tooling this
// (libimobiledevice, or verified `xcrun devicectl` log-streaming syntax)
// that hasn't been confirmed to work, so it throws a clear error instead of
// silently guessing at commands that might behave wrong in ways nobody
// would notice until a real investigation quietly produced bad evidence.

function requireSimulator(deviceId: string, isSimulator: boolean, action: string): void {
  if (!isSimulator) {
    throw new Error(
      `${action} isn't implemented yet for a physical iOS device (${deviceId}) — only the Simulator is ` +
        "supported so far (Phase 5 is simulator-first, physical device later). Pass an iOS Simulator instead.",
    );
  }
}

/**
 * Reads the iOS bundle identifier out of the Xcode project's own build
 * settings — Info.plist's CFBundleIdentifier is normally the variable
 * `$(PRODUCT_BUNDLE_IDENTIFIER)`, not a literal value, so the real answer
 * lives in project.pbxproj instead. Assumes the default Flutter iOS
 * scaffold (all build configs sharing one bundle id) — grabs the first match.
 */
export async function getIosBundleId(appPath: string): Promise<string> {
  const pbxproj = await readFile(join(appPath, "ios/Runner.xcodeproj/project.pbxproj"), "utf-8");
  const match = pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^\s;]+);/);
  if (!match) {
    throw new Error(`Could not find PRODUCT_BUNDLE_IDENTIFIER in ${appPath}/ios/Runner.xcodeproj/project.pbxproj`);
  }
  return match[1];
}

/** `log show --start` wants local wall-clock time in this exact format. */
export async function captureIosLogMarker(): Promise<string> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/**
 * Simulator only. Filters on process name "Runner" — the default target
 * name Flutter's iOS scaffold generates, same class of assumption as
 * native-log.ts's hardcoded "flutter" logcat tag on the Android side.
 */
export async function readIosLogSince(deviceId: string, isSimulator: boolean, marker: string): Promise<string> {
  requireSimulator(deviceId, isSimulator, "Native log capture");
  const { stdout } = await execFileAsync("xcrun", [
    "simctl",
    "spawn",
    deviceId,
    "log",
    "show",
    "--start",
    marker,
    "--predicate",
    'process == "Runner"',
    "--style",
    "compact",
  ]);
  return stdout.trim();
}

export async function forceStopIosApp(deviceId: string, isSimulator: boolean, bundleId: string): Promise<void> {
  requireSimulator(deviceId, isSimulator, "Force-stopping the app");
  await execFileAsync("xcrun", ["simctl", "terminate", deviceId, bundleId]).catch(() => {});
}
