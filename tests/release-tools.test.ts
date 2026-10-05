import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
const run = promisify(execFile);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

test("manifest extraction finds real Vanilla aliases and preserves output on missing declarations", async () => {
  const root = await mkdtemp(join(tmpdir(), "moe-extractor-"));
  try {
    await mkdir(join(root, "scripts")); await mkdir(join(root, "data"));
    await copyFile("scripts/generate-icons-data.mjs", join(root, "scripts/generate-icons-data.mjs"));
    await writeFile(join(root, "data/icons.json"), "[]\n");
    const catalog = JSON.stringify({ sourceCommit: "a".repeat(40), sourceVersion: "0.0.18", styleGroups: [{ id: "moe-outline", tiers: ["free", "pro"], formats: ["svg"] }], icons: [{ id: "ui-search", availableIn: ["moe-outline"], targets: ["react", "vue", "vanilla", "assets"] }] });
    const tier = { metadata: { files: { "catalog.json": { sha256: hash(catalog) } } } };
    const descriptor = JSON.stringify({ fullVersion: "0.0.18", sourceCommit: "a".repeat(40), free: tier, pro: tier });
    await writeFile(join(root, "release-descriptor.json"), descriptor);
    await writeFile(join(root, "release-input.json"), JSON.stringify({ schemaVersion: 1, descriptorSha256: hash(descriptor), resourceDigest: "b".repeat(64), sourceCommit: "a".repeat(40), resourceVersion: "0.0.18" }));
    for (const name of ["free", "pro"]) {
      await mkdir(join(root, name, "assets"), { recursive: true });
      await writeFile(join(root, name, "catalog.json"), catalog);
      await writeFile(join(root, name, "assets/manifest.json"), JSON.stringify({ assets: [{ path: "moe-outline/ui-search.svg" }] }));
      for (const target of ["react", "vue", "vanilla"]) {
        await mkdir(join(root, name, target, "moe-outline"), { recursive: true });
        const declarations = target === "vanilla" ? "export { default as uiSearch, default as UiSearch, createUiSearch } from './UiSearch';" : "export { default as uiSearch } from './UiSearch';";
        await writeFile(join(root, name, target, "moe-outline/index.d.ts"), declarations);
      }
    }
    await run(process.execPath, [join(root, "scripts/generate-icons-data.mjs"), root]);
    const output = await readFile(join(root, "data/icons.json"), "utf8");
    const manifest = JSON.parse(output);
    assert.equal(manifest.entries[0].bindings.find((item: {target: string}) => item.target === "vanilla").factoryName, "createUiSearch");
    assert.equal(manifest.entries[0].minimumTier, "free");
    await run(process.execPath, [join(root, "scripts/generate-icons-data.mjs"), root]);
    assert.equal(await readFile(join(root, "data/icons.json"), "utf8"), output);
    await rm(join(root, "free/react/moe-outline/index.d.ts"));
    await assert.rejects(run(process.execPath, [join(root, "scripts/generate-icons-data.mjs"), root]), /missing react declarations/);
    assert.equal(await readFile(join(root, "data/icons.json"), "utf8"), output);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release allocation is idempotent and interrupted writes recover before the next operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "moe-release-state-"));
  try {
    await mkdir(join(root, "scripts")); await mkdir(join(root, "data"));
    await copyFile("scripts/release-state.mjs", join(root, "scripts/release-state.mjs"));
    const baseline = {
      "package.json": { version: "0.0.1" },
      "package-lock.json": { version: "0.0.1", packages: { "": { version: "0.0.1" } } },
      "data/version-map.json": [{ pluginVersion: "0.0.1", libraryVersion: "0.0.17" }],
      "data/release-state.json": { schemaVersion: 1, current: { pluginVersion: "0.0.1", cliVersion: "0.0.3", resourceVersion: "0.0.17" }, events: [] },
    };
    for (const [file, value] of Object.entries(baseline)) await writeFile(join(root, file), JSON.stringify(value));
    const event = { schemaVersion: 1, eventId: "resource:0.0.18", sourceRepository: "moewolf-dev/moe-icons-code-library", sourceVersion: "0.0.18", sourceCommit: "a".repeat(40), cliVersion: "0.0.3", resourceVersion: "0.0.18", resourceDigest: "b".repeat(64), descriptorSha256: "c".repeat(64) };
    const eventFile = join(root, "event.json");
    await writeFile(eventFile, JSON.stringify(event));
    const args = [join(root, "scripts/release-state.mjs"), "allocate", eventFile];
    const allocated = JSON.parse((await run(process.execPath, args)).stdout);
    assert.equal(allocated.pluginVersion, "0.0.2");
    await writeFile(eventFile, JSON.stringify(Object.fromEntries(Object.entries(event).reverse())));
    assert.equal(JSON.parse((await run(process.execPath, args)).stdout).duplicate, true);
    const files = await Promise.all(["package.json", "package-lock.json", "data/version-map.json", "data/release-state.json"].map(async file => {
      const path = join(root, file), content = await readFile(path, "utf8");
      return { path, content, before: hash(content) };
    }));
    const original = files[0].content;
    files[0].content = original.trim() + "\n\n";
    await writeFile(join(root, ".release-state-transaction.json"), JSON.stringify({ schemaVersion: 1, files: files.map(file => ({ ...file, path: relative(root, file.path) })) }));
    // Simulate the crash after replacing the first file and before replacing the rest.
    await writeFile(files[0].path, files[0].content);
    assert.equal(JSON.parse((await run(process.execPath, args)).stdout).duplicate, true);
    for (const file of files) assert.equal(await readFile(file.path, "utf8"), file.content);
    await assert.rejects(readFile(join(root, ".release-state-transaction.json")), /ENOENT/);
    await mkdir(join(root, ".release-state-lock"));
    await writeFile(join(root, ".release-state-lock/owner.json"), JSON.stringify({ pid: process.pid }));
    await assert.rejects(run(process.execPath, args), /another release operation is running/);
    assert.equal(await readFile(files[0].path, "utf8"), files[0].content);
  } finally { await rm(root, { recursive: true, force: true }); }
});
