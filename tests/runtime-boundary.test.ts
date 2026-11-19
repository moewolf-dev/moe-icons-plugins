import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const read = (file: string) => readFileSync(join(root, file), "utf8");

test("the extension engine stays VS Code-only and has no user Node requirement", () => {
  const pkg = JSON.parse(read("package.json")) as { engines?: Record<string, string>; version?: string };
  assert.equal(pkg.engines?.vscode, "^1.85.0");
  assert.equal(pkg.engines?.node, undefined);
  assert.equal(read(".nvmrc").trim(), "24");
});

test("development, CI, packaging and release workflows use Node 24", () => {
  const workflows = readdirSync(join(root, ".github/workflows")).filter(name => name.endsWith(".yml"));
  assert.ok(workflows.length >= 5);
  for (const name of workflows) {
    const text = read(`.github/workflows/${name}`);
    assert.doesNotMatch(text, /node-version:\s*(?:18|20|22)\b/, name);
    if (text.includes("setup-node")) assert.match(text, /node-version:\s*24\b/, name);
  }
});

test("documentation distinguishes the Extension Host from CLI/dev Node 24", () => {
  const readme = read("README.md");
  assert.match(readme, /Extension Host/);
  assert.match(readme, /Node\.js 24/);
  assert.match(readme, /do not need to install Node/i);
  assert.doesNotMatch(readme, /Node(?:\.js)?\s*(?:18|20|22)/);
  for (const name of readdirSync(join(root, "docs")).filter(name => name.endsWith(".md"))) {
    const text = read(`docs/${name}`);
    assert.doesNotMatch(text, /Node(?:\.js)?\s*(?:18|20|22)/, name);
  }
});

test("the current plugin version records a verified CLI/resource combination", () => {
  const pkg = JSON.parse(read("package.json")) as { version?: string };
  const map = JSON.parse(read("data/version-map.json")) as { schemaVersion: number; history: Array<{ pluginVersion: string; cliVersion?: string; resourceVersion?: string }> };
  assert.equal(map.schemaVersion, 1);
  const current = map.history.find(entry => entry.pluginVersion === pkg.version);
  assert.ok(current, "current package version must appear in data/version-map.json");
  assert.equal(typeof current.cliVersion, "string");
  assert.equal(typeof current.resourceVersion, "string");
});
