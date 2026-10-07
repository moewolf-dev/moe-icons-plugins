import { stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
const inside = (root: string, file: string): boolean => { const rel = relative(root, file); return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };

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

