import { test } from "node:test";
import assert from "node:assert/strict";
import { getVersionMap, findLibraryVersion } from "../src/version";

test("version map is non-empty and well-formed", () => {
  const map = getVersionMap();
  assert.ok(map.length > 0, "version map should have at least one entry");
  for (const entry of map) {
    assert.equal(typeof entry.pluginVersion, "string");
    assert.equal(typeof (entry.resourceVersion ?? entry.libraryVersion), "string");
  }
});

test("findLibraryVersion resolves a known plugin version", () => {
  const map = getVersionMap();
  const first = map[0];
  assert.ok(first !== undefined);
  assert.equal(findLibraryVersion(first.pluginVersion), first.resourceVersion ?? first.libraryVersion);
});
