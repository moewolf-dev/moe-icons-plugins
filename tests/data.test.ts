import { test } from "node:test";
import assert from "node:assert/strict";
import { loadIcons, searchIcons, toComponentName } from "../src/data";

test("loadIcons returns non-empty entries with the three required fields", () => {
  const icons = loadIcons();
  assert.ok(icons.length > 0, "icons.json should contain at least one icon");

  for (const icon of icons) {
    assert.equal(typeof icon.name, "string");
    assert.equal(typeof icon.styleGroup, "string");
    assert.ok(icon.tier === "free" || icon.tier === "pro");
  }
});

test("icon names preserve hyphens", () => {
  const icons = loadIcons();
  const hyphenated = icons.find((icon) => icon.name.includes("-"));
  assert.ok(hyphenated !== undefined, "there should be at least one hyphenated name");
});

test("searchIcons matches by name prefix", () => {
  const results = searchIcons("arrow");
  assert.ok(results.length > 0, "searching 'arrow' should yield results");
  for (const icon of results) {
    assert.ok(
      icon.name.toLowerCase().startsWith("arrow"),
      `unexpected result: ${icon.name}`,
    );
  }
});

test("searchIcons matches by component-name prefix", () => {
  const known = loadIcons().find(icon => icon.name.includes("-"));
  assert.ok(known, "published metadata must contain a compound canonical icon ID");
  const prefix = toComponentName(known.name);
  const results = searchIcons(prefix);
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
