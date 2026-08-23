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
 * Inserts `code` as a new line after `afterLine` (0 = insert as the first
 * line). The original content is backed up in `backups` on first touch of a
 * given file, so revertFile/revertAll can restore it exactly — never
 * overwrites an existing backup, so calling this twice on the same file
 * before reverting stacks edits without losing the true original.
 */
export async function instrumentFile(
  backups: Map<string, string>,
  appPath: string,
  relativeFilePath: string,
  afterLine: number,
  code: string,
): Promise<void> {
  const absPath = resolveInstrumentedPath(appPath, relativeFilePath);
  if (!backups.has(absPath)) {
    backups.set(absPath, await readFile(absPath, "utf-8"));
  }
  const current = await readFile(absPath, "utf-8");
  const lines = current.split("\n");
  if (afterLine < 0 || afterLine > lines.length) {
    throw new Error(`Line ${afterLine} is out of range for ${relativeFilePath} (${lines.length} lines)`);
  }
  lines.splice(afterLine, 0, code);
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
