import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadIcons, parseIconManifest, searchIcons, toComponentName } from "../src/data";

const bundledCatalog = JSON.parse(readFileSync(new URL("../data/icons.json", import.meta.url), "utf8")) as unknown;

test("loadIcons returns non-empty entries with the three required fields", () => {
  const icons = loadIcons(bundledCatalog);
  assert.ok(icons.length > 0, "icons.json should contain at least one icon");

  for (const icon of icons) {
    assert.equal(typeof icon.name, "string");
    assert.equal(typeof icon.styleGroup, "string");
    assert.ok(icon.tier === "free" || icon.tier === "pro");
  }
});

test("icon names preserve hyphens", () => {
  const icons = loadIcons(bundledCatalog);
  const hyphenated = icons.find((icon) => icon.name.includes("-"));
  assert.ok(hyphenated !== undefined, "there should be at least one hyphenated name");
});

test("searchIcons matches by name prefix", () => {
  const results = searchIcons("arrow", bundledCatalog);
  assert.ok(results.length > 0, "searching 'arrow' should yield results");
  for (const icon of results) {
    assert.ok(
      icon.name.toLowerCase().startsWith("arrow"),
      `unexpected result: ${icon.name}`,
    );
  }
});

test("searchIcons matches by component-name prefix", () => {
  const known = loadIcons(bundledCatalog).find(icon => icon.name.includes("-"));
  assert.ok(known, "published metadata must contain a compound canonical icon ID");
  const prefix = toComponentName(known.name);
  const results = searchIcons(prefix, bundledCatalog);
  assert.ok(results.length > 0);
  for (const icon of results) {
    assert.ok(toComponentName(icon.name).startsWith(prefix));
  }
});

test("toComponentName converts kebab-case to the canonical PascalCase export without an invented suffix", () => {
  assert.equal(toComponentName("arrow-chevron-right"), "ArrowChevronRight");
  assert.equal(toComponentName("archive"), "Archive");
  assert.equal(toComponentName("user-account"), "UserAccount");
});

test("package-set metadata manifests load as compact completion entries", () => {
  const binding = (tier: "free" | "pro") => ({
    tier,
    fullVersion: "1.2.3",
    sourceCommit: "a".repeat(40),
    generatorCommit: "b".repeat(40),
    packageSetSha256: tier === "free" ? "c".repeat(64) : "d".repeat(64),
    candidateRootSha256: tier === "free" ? "e".repeat(64) : "f".repeat(64),
    candidateRootBytes: 512,
  });
  const manifest = {
    schemaVersion: 2,
    resourceVersion: "1.2.3",
    sourceCommit: "a".repeat(40),
    candidateSets: { free: binding("free"), pro: binding("pro") },
    entries: [
      { id: "archive-box", styleGroup: "moe-outline", minimumTier: "free" },
      { id: "pixel-sword", styleGroup: "moe-game-blue", minimumTier: "pro" },
    ],
  };
  assert.equal(parseIconManifest(manifest).schemaVersion, 2);
  assert.deepEqual(loadIcons(manifest), [
    { name: "archive-box", styleGroup: "moe-outline", tier: "free" },
    { name: "pixel-sword", styleGroup: "moe-game-blue", tier: "pro" },
  ]);
  assert.throws(() => parseIconManifest({ ...manifest, entries: [...manifest.entries, manifest.entries[0]] }), /duplicate styleGroup\/id/);
});
