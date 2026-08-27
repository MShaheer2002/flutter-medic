import assert from "node:assert";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

interface UiNode {
  text: string;
  contentDesc: string;
  bounds: string;
  clickable: boolean;
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/(\w[\w-]*)="([^"]*)"/g)) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

/** uiautomator's dump is a flat list of self-describing `<node ... />` tags — no nesting-aware parsing needed. */
export function parseUiNodes(xml: string): UiNode[] {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map((m) => {
    const a = parseAttrs(m[0]);
    return {
      text: a.text ?? "",
      contentDesc: a["content-desc"] ?? "",
      bounds: a.bounds ?? "",
      clickable: a.clickable === "true",
    };
  });
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function parseBounds(bounds: string): Rect | null {
  const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  return { x1, y1, x2, y2 };
}

function centerOf(bounds: string): { x: number; y: number } | null {
  const r = parseBounds(bounds);
  return r && { x: Math.round((r.x1 + r.x2) / 2), y: Math.round((r.y1 + r.y2) / 2) };
}

function contains(outer: Rect, inner: Rect): boolean {
  return outer.x1 <= inner.x1 && outer.y1 <= inner.y1 && outer.x2 >= inner.x2 && outer.y2 >= inner.y2;
}

function area(r: Rect): number {
  return (r.x2 - r.x1) * (r.y2 - r.y1);
}

function textMatches(n: UiNode, needle: string): boolean {
  return n.text.toLowerCase().includes(needle) || n.contentDesc.toLowerCase().includes(needle);
}

/**
 * Case-insensitive substring match on visible text or accessibility label.
 * Tries a node that's directly clickable and carries the text itself first
 * (a plain button). Falls back to walking up to the smallest clickable
 * ancestor by bounds-containment — Android's standard list-row pattern (a
 * ListView "container" handles the click, the visible text sits in a
 * non-clickable child TextView) means the two are very often different
 * nodes; found live against a real account picker, not assumed.
 */
export function findTappableNode(nodes: UiNode[], label: string): UiNode | undefined {
  const needle = label.toLowerCase();

  const direct = nodes.find((n) => n.clickable && textMatches(n, needle));
  if (direct) return direct;

  const match = nodes.find((n) => textMatches(n, needle));
  const matchBounds = match && parseBounds(match.bounds);
  if (!matchBounds) return undefined;

  let best: UiNode | undefined;
  let bestArea = Infinity;
  for (const n of nodes) {
    if (!n.clickable) continue;
    const b = parseBounds(n.bounds);
    if (!b || !contains(b, matchBounds)) continue;
    const a = area(b);
    if (a < bestArea) {
      bestArea = a;
      best = n;
    }
  }
  return best;
}

/**
 * Taps a native (non-Flutter) UI element by visible text or accessibility
 * label. `uiautomator dump` and `input tap` both operate at the Android
 * window-manager level, not scoped to any one app — they see system dialogs
 * (permission prompts, Chrome Custom Tab sign-in sheets) the same as normal
 * app content, no target-app changes required. Doesn't touch the Dart VM at
 * all, so it can't conflict with a live Marionette session the way Patrol did.
 *
 * Android only for now — iOS needs idb (`idb ui tap`/`describe-all`), not
 * yet wired in; see doc/ for why.
 */
export async function tapNativeAndroid(
  deviceId: string,
  label: string,
): Promise<{ x: number; y: number; matchedLabel: string }> {
  await execFileAsync("adb", ["-s", deviceId, "shell", "uiautomator", "dump", "/sdcard/window_dump.xml"]);
  const { stdout: xml } = await execFileAsync("adb", ["-s", deviceId, "shell", "cat", "/sdcard/window_dump.xml"]);

  const node = findTappableNode(parseUiNodes(xml), label);
  if (!node) {
    throw new Error(`No tappable native element matching "${label}" found on screen.`);
  }
  const center = centerOf(node.bounds);
  if (!center) {
    throw new Error(`Matched "${label}" but couldn't parse its bounds ("${node.bounds}").`);
  }

  await execFileAsync("adb", ["-s", deviceId, "shell", "input", "tap", String(center.x), String(center.y)]);
  return { x: center.x, y: center.y, matchedLabel: label };
}

// --- iOS (idb) ---
//
// idb (Meta's iOS Development Bridge) exposes the same kind of accessibility
// dump as uiautomator, via `idb ui describe-all`/`idb ui tap`. Verified live
// against a real booted Simulator: works for native system dialogs (alerts,
// permission prompts) and the ASWebAuthenticationSession consent sheet —
// but NOT for content rendered inside a WKWebView (e.g. the actual Google
// account picker that sheet opens into), which returns zero accessibility
// nodes even after retrying. That's a real platform difference from
// Android's equivalent (a native Activity there), not a gap in this code.
//
// Requires `idb` on PATH (deliberately not hardcoded to any one install
// method — pip, pipx, or brew's facebook/fb/idb-cli all put it on PATH) and
// idb_companion running for the target simulator, which this connects to
// on demand rather than assuming it's already up.

const IDB_BIN = "idb";

interface IosUiNode {
  label: string;
  frame: { x: number; y: number; width: number; height: number } | null;
  enabled: boolean;
}

/** idb's describe-all is a flat JSON array — accessibility labels sit directly on the interactive element itself (no Android-style ancestor-walk needed, confirmed against real dialogs). */
export function parseIosUiNodes(json: string): IosUiNode[] {
  const raw: unknown[] = JSON.parse(json);
  return raw.map((n) => {
    const o = n as Record<string, unknown>;
    const label = (o.AXLabel as string) || (o.title as string) || "";
    const frame = o.frame as IosUiNode["frame"];
    return { label: typeof label === "string" ? label : "", frame, enabled: o.enabled !== false };
  });
}

function centerOfFrame(frame: NonNullable<IosUiNode["frame"]>): { x: number; y: number } {
  return { x: Math.round(frame.x + frame.width / 2), y: Math.round(frame.y + frame.height / 2) };
}

export function findIosNode(nodes: IosUiNode[], label: string): IosUiNode | undefined {
  const needle = label.toLowerCase();
  return nodes.find((n) => n.enabled && n.label.toLowerCase().includes(needle));
}

/** Connects the idb CLI to a running companion for this simulator, starting one if none is up yet. Idempotent — safe to call before every tap. */
async function ensureIdbConnected(udid: string): Promise<void> {
  const { stdout } = await execFileAsync(IDB_BIN, ["list-targets"]).catch(() => ({ stdout: "" }));
  const line = stdout.split("\n").find((l) => l.includes(udid));
  if (line && !line.includes("No Companion Connected")) return;

  const companion = spawn("idb_companion", ["--udid", udid], { detached: true, stdio: "ignore" });
  companion.unref();
  await new Promise((r) => setTimeout(r, 3000));
  await execFileAsync(IDB_BIN, ["connect", "localhost", "10882"]);
}

export async function tapNativeIos(
  udid: string,
  label: string,
): Promise<{ x: number; y: number; matchedLabel: string }> {
  await ensureIdbConnected(udid);

  const { stdout: json } = await execFileAsync(IDB_BIN, ["ui", "describe-all", "--udid", udid]);
  const node = findIosNode(parseIosUiNodes(json), label);
  if (!node || !node.frame) {
    throw new Error(
      `No tappable native element matching "${label}" found on screen. If this is inside a web-rendered ` +
        `sign-in flow (e.g. Google/Facebook OAuth), that's a known idb limitation, not a bug — it can't see ` +
        `into a WKWebView's content.`,
    );
  }
  const center = centerOfFrame(node.frame);

  await execFileAsync(IDB_BIN, ["ui", "tap", String(center.x), String(center.y), "--udid", udid]);
  return { x: center.x, y: center.y, matchedLabel: label };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // Case 1: a plain button — text and clickable on the same node.
  const buttonXml =
    '<hierarchy><node text="" class="a" bounds="[0,0][1080,2400]">' +
    '<node text="Allow" class="b" clickable="true" bounds="[100,200][300,260]" />' +
    '<node text="Deny" content-desc="" class="c" clickable="true" bounds="[400,200][600,260]" />' +
    "</node></hierarchy>";
  const buttonMatch = findTappableNode(parseUiNodes(buttonXml), "allow");
  assert.strictEqual(buttonMatch?.text, "Allow");
  assert.deepStrictEqual(centerOf(buttonMatch.bounds), { x: 200, y: 230 });

  // Case 2: Android's list-row pattern — text sits in a non-clickable child,
  // the clickable "container" ancestor has no text of its own. Modeled
  // directly on the real account-picker dump this was found against, plus a
  // second, larger clickable ancestor further up that must NOT be picked.
  const rowXml =
    '<hierarchy><node text="" class="root" clickable="false" bounds="[0,0][720,2400]">' +
    '<node text="" class="scrollview" clickable="true" bounds="[0,400][720,2000]">' +
    '<node text="" class="container" resource-id="container" clickable="true" bounds="[48,500][672,628]">' +
    '<node text="Shaheer Project" class="name" clickable="false" bounds="[161,528][352,568]" />' +
    '<node text="shaheerprojectsflutter@gmail.com" class="email" clickable="false" bounds="[161,570][450,600]" />' +
    "</node></node></node></hierarchy>";
  const rowMatch = findTappableNode(parseUiNodes(rowXml), "Shaheer Project");
  assert.strictEqual(rowMatch?.text, "", "should tap the clickable container, not the text node itself");
  assert.deepStrictEqual(rowMatch && parseBounds(rowMatch.bounds), { x1: 48, y1: 500, x2: 672, y2: 628 });

  // iOS: label sits directly on the node, modeled on the real
  // ASWebAuthenticationSession sheet ({"AXLabel": "Continue", ...}).
  const iosJson = JSON.stringify([
    { AXLabel: "Cancel", frame: { x: 100, y: 400, width: 120, height: 50 }, enabled: true },
    { AXLabel: "Continue", frame: { x: 300, y: 400, width: 120, height: 50 }, enabled: true },
  ]);
  const iosMatch = findIosNode(parseIosUiNodes(iosJson), "continue");
  assert.strictEqual(iosMatch?.label, "Continue");
  assert.deepStrictEqual(iosMatch.frame && centerOfFrame(iosMatch.frame), { x: 360, y: 425 });

  console.log("native-tap self-check passed");
}
