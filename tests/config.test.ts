import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectLibraryVersion } from "../src/config";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "moe-icons-plugins-test-"));
}

test("detectLibraryVersion returns unknown when no config and no package", () => {
  const root = makeTmpDir();
  try {
    const result = detectLibraryVersion(root);
    assert.deepEqual(result, { kind: "unknown" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectLibraryVersion reads version from moeicons.config.ts", () => {
  const root = makeTmpDir();
  try {
    writeFileSync(
      join(root, "moeicons.config.ts"),
      'export default { defaultTheme: "outline", version: "0.0.17" };\n',
    );
    const result = detectLibraryVersion(root);
    assert.deepEqual(result, {
      kind: "ok",
      version: "0.0.17",
      source: "config",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectLibraryVersion falls back to node_modules package.json", () => {
  const root = makeTmpDir();
  try {
    const pkgDir = join(root, "node_modules", "moe-icons");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "moe-icons", version: "0.0.16" }),
    );
    const result = detectLibraryVersion(root);
    assert.deepEqual(result, {
      kind: "ok",
      version: "0.0.16",
      source: "package",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
