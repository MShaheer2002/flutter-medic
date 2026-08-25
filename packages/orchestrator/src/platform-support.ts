import type { DevicePlatform } from "./device-detection.js";
import { forceStopIosApp, getIosBundleId, captureIosLogMarker, readIosLogSince } from "./ios-support.js";
import { forceStopApp as forceStopAndroidApp } from "./mcp-clients.js";
import { captureLogMarker as captureAndroidLogMarker, getAndroidApplicationId, readFlutterLogSince } from "./native-log.js";

/** Bundle ID (iOS) or applicationId (Android) — whichever the platform calls it. */
export async function getApplicationId(platform: DevicePlatform, appPath: string): Promise<string> {
  return platform === "ios" ? getIosBundleId(appPath) : getAndroidApplicationId(appPath);
}

export async function captureLogMarker(platform: DevicePlatform, deviceId: string): Promise<string> {
  return platform === "ios" ? captureIosLogMarker() : captureAndroidLogMarker(deviceId);
}

export async function readNativeLogSince(
  platform: DevicePlatform,
  deviceId: string,
  isSimulator: boolean,
  applicationId: string,
  marker: string,
): Promise<string> {
  return platform === "ios" ? readIosLogSince(deviceId, isSimulator, marker) : readFlutterLogSince(deviceId, applicationId, marker);
}

/** Best-effort — never throws, since a failed force-stop shouldn't block closing a session. */
export async function forceStopApp(
  platform: DevicePlatform,
  deviceId: string,
  isSimulator: boolean,
  applicationId: string,
): Promise<void> {
  if (platform === "ios") {
    await forceStopIosApp(deviceId, isSimulator, applicationId).catch(() => {});
  } else {
    await forceStopAndroidApp(deviceId, applicationId);
  }
}
