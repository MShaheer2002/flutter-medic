import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Reads the Android application ID out of build.gradle(.kts) — this is what
 * `adb logcat --pid` needs to scope to the right process. Tries Kotlin DSL
 * first, falls back to Groovy: real projects use either (found live —
 * E-Commerce-App uses plain build.gradle, not .kts). Groovy also allows
 * `applicationId "..."` without `=` across older AGP versions, so both are
 * matched.
 */
export async function getAndroidApplicationId(appPath: string): Promise<string> {
  const candidates = ["android/app/build.gradle.kts", "android/app/build.gradle"];
  for (const candidate of candidates) {
    const gradle = await readFile(join(appPath, candidate), "utf-8").catch(() => null);
    if (gradle === null) continue;
    const match = gradle.match(/applicationId\s*=?\s*"([^"]+)"/);
    if (match) return match[1];
  }
  throw new Error(`Could not find applicationId in ${appPath}/android/app/build.gradle(.kts)`);
}

/** Captures the device's current time, in the format `adb logcat -T` expects. */
export async function captureLogMarker(deviceId: string): Promise<string> {
  const { stdout } = await execFileAsync("adb", ["-s", deviceId, "shell", "date '+%m-%d %H:%M:%S.000'"]);
  return stdout.trim();
}

/**
 * Reads logcat lines tagged "flutter" (the engine's own error/print output —
 * see doc/007) for the app's process, since `marker`. This is a backstop for
 * exception classes get_runtime_errors structurally can't see (unhandled
 * fire-and-forget async errors, root-caused in doc/007) — the Flutter engine
 * prints those straight to native platform logging, bypassing the VM service
 * entirely, so this is currently the only reliable way to catch them.
 */
export async function readFlutterLogSince(
  deviceId: string,
  applicationId: string,
  marker: string,
): Promise<string> {
  let pid: string | undefined;
  try {
    const { stdout } = await execFileAsync("adb", ["-s", deviceId, "shell", `pidof ${applicationId}`]);
    pid = stdout.trim().split(/\s+/)[0];
  } catch {
    // Process not found — likely crashed hard enough to lose its PID entirely.
    // Fall through and read unscoped; still timestamp-bounded.
  }

  // "-v epoch" prefixes each line with a raw epoch-seconds timestamp instead
  // of the default no-year local-clock format — the only way to correlate
  // these lines against networkActivity's own epoch-microsecond timestamps
  // (log-correlation.ts) without guessing at device/host timezone alignment.
  const args = ["-s", deviceId, "logcat", "-v", "epoch", "-d", "-T", marker, "-s", "flutter:E"];
  if (pid) args.push("--pid", pid);

  const { stdout } = await execFileAsync("adb", args);
  return stdout.trim();
}
