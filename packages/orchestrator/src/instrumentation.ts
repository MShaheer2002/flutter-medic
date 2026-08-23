import { isAbsolute, relative, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Refuses anything that resolves outside the active app's own directory —
 * this tool writes to disk, and appPath can be any project on the user's
 * machine, so a relative path escaping it (`../../something`) must never
 * silently touch a file outside the app being investigated.
 */
function resolveInstrumentedPath(appPath: string, relativeFilePath: string): string {
  const resolved = resolve(appPath, relativeFilePath);
  const rel = relative(appPath, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to instrument a path outside the active app: ${relativeFilePath}`);
  }
  return resolved;
}

/**
 * Inserts `code` as a new line at `atLine` — a 0-indexed position, so the
 * new line lands BEFORE whatever line currently sits there (atLine=0 means
 * "insert as the new first line", atLine=N means "insert as the new line
 * N+1, pushing the old line N+1 and everything after it down by one"). The
 * original content is backed up in `backups` on first touch of a given
 * file, so revertFile/revertAll can restore it exactly — never overwrites
 * an existing backup, so calling this twice on the same file before
 * reverting stacks edits without losing the true original.
 */
export async function instrumentFile(
  backups: Map<string, string>,
  appPath: string,
  relativeFilePath: string,
  atLine: number,
  code: string,
): Promise<void> {
  const absPath = resolveInstrumentedPath(appPath, relativeFilePath);
  if (!backups.has(absPath)) {
    backups.set(absPath, await readFile(absPath, "utf-8"));
  }
  const current = await readFile(absPath, "utf-8");
  const lines = current.split("\n");
  if (atLine < 0 || atLine > lines.length) {
    throw new Error(`Line ${atLine} is out of range for ${relativeFilePath} (${lines.length} lines)`);
  }
  lines.splice(atLine, 0, code);
  await writeFile(absPath, lines.join("\n"), "utf-8");
}

export async function revertFile(
  backups: Map<string, string>,
  appPath: string,
  relativeFilePath: string,
): Promise<boolean> {
  const absPath = resolveInstrumentedPath(appPath, relativeFilePath);
  const original = backups.get(absPath);
  if (original === undefined) return false;
  await writeFile(absPath, original, "utf-8");
  backups.delete(absPath);
  return true;
}

/** Safety net for close_app — restores anything left instrumented, even if the caller forgot. */
export async function revertAll(backups: Map<string, string>): Promise<string[]> {
  const absPaths = [...backups.keys()];
  for (const absPath of absPaths) {
    await writeFile(absPath, backups.get(absPath)!, "utf-8");
  }
  backups.clear();
  return absPaths;
}
