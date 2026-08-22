import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { InvestigationStep } from "./reproduction.js";

// First-run-wins baselines for tier-2 (doc/016): stored per-machine, keyed by
// app + interaction path, not inside the target app's own repo — flutter-medic
// shouldn't write generated files into a project it doesn't own.
const BASELINE_DIR = join(homedir(), ".flutter-medic", "baselines");

function baselineKey(appPath: string, steps: InvestigationStep[], expectedElementKey?: string): string {
  const hash = createHash("sha1").update(JSON.stringify({ appPath, steps, expectedElementKey })).digest("hex");
  return `${hash}.txt`;
}

export async function loadBaseline(
  appPath: string,
  steps: InvestigationStep[],
  expectedElementKey: string | undefined,
): Promise<string | null> {
  try {
    return await readFile(join(BASELINE_DIR, baselineKey(appPath, steps, expectedElementKey)), "utf-8");
  } catch {
    return null;
  }
}

export async function saveBaseline(
  appPath: string,
  steps: InvestigationStep[],
  expectedElementKey: string | undefined,
  interactiveElements: string,
): Promise<void> {
  await mkdir(BASELINE_DIR, { recursive: true });
  await writeFile(join(BASELINE_DIR, baselineKey(appPath, steps, expectedElementKey)), interactiveElements, "utf-8");
}
