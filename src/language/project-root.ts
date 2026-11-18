import { stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
const inside = (root: string, file: string): boolean => { const rel = relative(root, file); return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };

const markers = [
  ".moeicons",
  "moeicons.config.ts",
  "moeicons.config.js",
  "moeicons.config.json",
  "moeicons.config.jsonc",
  "node_modules/@moewolf/moe-icons-cli/package.json",
] as const;

/** Search toward the workspace boundary without executing project configuration. */
export async function findManagedProjectRoot(start: string, boundary: string): Promise<string | undefined> {
  let current = resolve(start);
  const limit = resolve(boundary);
  while (inside(limit, current)) {
    try { if ((await stat(resolve(current, ".moeicons/install-metadata.json"))).isFile()) return current; } catch { /* Continue upward. */ }
    if (current === limit) break;
    current = dirname(current);
  }
  return undefined;
}

/**
 * Find a directory that looks CLI-managed even when generation has not run yet.
 * This lets the extension say "project not generated" instead of "CLI missing".
 */
export async function findProjectCandidateRoot(start: string, boundary: string): Promise<string | undefined> {
  let current = resolve(start);
  const limit = resolve(boundary);
  while (inside(limit, current)) {
    for (const marker of markers) {
      try {
        await stat(resolve(current, marker));
        return current;
      } catch { /* Try the next marker or parent. */ }
    }
    if (current === limit) break;
    current = dirname(current);
  }
  return undefined;
}
