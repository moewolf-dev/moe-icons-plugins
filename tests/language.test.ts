import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeDocument } from "../src/language/analyze";
import type { PublicModule, PublicSymbol } from "../src/language/contracts";
import { loadErrorCodes, formatIssue } from "../src/diagnostics/core";

const component: PublicSymbol = { kind: "component", iconId: "ui-search" };
const factory: PublicSymbol = { kind: "factory", iconId: "ui-search" };
const module: PublicModule = { complete: true, exports: new Map([
  ["UiSearch", component], ["createUiSearch", factory],
  ["MoeOutline", { kind: "namespace", members: new Map([["createUiSearch", factory]]) }],
]) };
const resolve = (name: string): PublicModule | undefined => name === "./moeicons" ? module : undefined;
const analyze = (text: string, language = "typescriptreact") => analyzeDocument(text, language, resolve);

test("import aliases are recognized; unrelated components, comments and strings are excluded", () => {
  const text = `import { UiSearch as Search } from './moeicons';
import { UiSearch } from './business';
const text = 'Search UiSearch'; // Search
const node = <><Search /><UiSearch /></>;`;
  const result = analyze(text);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.occurrences.map(item => item.name), ["Search", "Search"]);
  for (const occurrence of result.occurrences) assert.equal(text.slice(occurrence.start, occurrence.end), "Search");
});

test("lexical binding identity excludes shadowed parameters and local variables", () => {
  const result = analyze(`import { UiSearch } from './moeicons';
const a = <UiSearch />;
function render(UiSearch: unknown) { return <UiSearch />; }
{ const UiSearch = () => null; const b = <UiSearch />; }`);
  assert.equal(result.occurrences.length, 2);
});

test("namespace factory calls, nested namespaces and unknown exports have precise ranges", () => {
  const text = `import * as Icons from './moeicons'; Icons.createUiSearch(); Icons.MoeOutline.createUiSearch(); Icons.Missing();`;
  const result = analyze(text, "typescript");
  assert.deepEqual(result.occurrences.map(item => item.name), ["createUiSearch", "createUiSearch"]);
  assert.deepEqual(result.issues.map(item => text.slice(item.start, item.end)), ["Missing"]);
});

test("namespace property names in unrelated objects and shadowed namespaces are excluded", () => {
  const result = analyze(`import * as Icons from './moeicons'; const obj = { Icons: 1, UiSearch: 2 };
function render(Icons: unknown) { return Icons.Missing; }`);
  assert.equal(result.issues.length, 0);
  assert.equal(result.occurrences.length, 0);
});

test("computed and dynamic members fail open", () => {
  const result = analyze(`import * as Icons from './moeicons'; const a = Icons['Missing']; const b = Icons[name];`);
  assert.equal(result.issues.length, 0);
});

test("type-only imports are not treated as icon usages", () => {
  assert.equal(analyze(`import type { UiSearch } from './moeicons'; let a: UiSearch;`).occurrences.length, 0);
  assert.equal(analyze(`import { type Missing } from './moeicons';`).issues.length, 0);
});

test("unknown imports are checked only against complete verified export surfaces", () => {
  assert.equal(analyze(`import { Missing } from './moeicons';`).issues.length, 1);
  const unresolved = analyzeDocument(`import { Missing } from './moeicons'; <Missing />;`, "typescriptreact", () => ({ ...module, complete: false }));
  assert.equal(unresolved.issues.length, 0);
  assert.equal(analyze(`import { Missing } from './unrelated'; <Missing />;`).issues.length, 0);
});

test("incomplete JSX tag does not produce an unknown export diagnostic", () => {
  const result = analyze(`import * as Icons from './moeicons'; const a = <Icons.Miss`);
  assert.equal(result.issues.length, 0);
});

test("namespace completions use actual exports and do not invent Icon suffixes", () => {
  const text = `import * as Icons from './moeicons'; const a = <Icons.Ui />;`;
  const result = analyze(text);
  const offset = text.indexOf("Icons.Ui") + "Icons.Ui".length;
  assert.deepEqual(result.completions(offset).map(item => item.name), ["UiSearch"]);
});

test("completion works for incomplete JSX and factory property access", () => {
  for (const text of [`import * as Icons from './moeicons'; const a = <Icons.Ui`, `import * as Icons from './moeicons'; Icons.createUi`]) {
    const items = analyze(text).completions(text.length);
    assert.equal(items.length, 1);
    assert.ok(["UiSearch", "createUiSearch"].includes(items[0].name));
  }
});

test("completion excludes comments, strings, attributes and unrelated namespaces", () => {
  for (const suffix of ["// <Icons.Ui", `const s = '<Icons.Ui';`, `<div title="Icons.Ui" />`, `<Other.Ui />`]) {
    const text = `import * as Icons from './moeicons'; ${suffix}`;
    const at = text.indexOf(".Ui", text.indexOf(";") + 1) + 3;
    assert.equal(analyze(text).completions(at).length, 0, suffix);
  }
});

test("Vue script setup component aliases and kebab tags retain original offsets", () => {
  const text = `<script setup lang="ts">\r\nimport { UiSearch as SearchIcon } from './moeicons';\r\n</script>\r\n<template><SearchIcon /><search-icon /></template>`;
  const result = analyze(text, "vue");
  assert.deepEqual(result.occurrences.map(item => item.name), ["SearchIcon", "SearchIcon", "search-icon"]);
  for (const item of result.occurrences) assert.equal(text.slice(item.start, item.end), item.name);
});

test("Vue comments, slot/loop shadows, Options API imports and dynamic components fail open", () => {
  const setup = `<script setup>import { UiSearch } from './moeicons';</script>`;
  const text = `${setup}<template><!-- <UiSearch /> --><div v-for="UiSearch in items"><UiSearch /></div><div v-slot="{ UiSearch }"><UiSearch /></div><component :is="name" /><div v-pre><UiSearch /></div></template>`;
  assert.equal(analyze(text, "vue").occurrences.length, 1);
  assert.equal(analyze(setup.replace(" setup", "") + `<template><UiSearch /></template>`, "vue").occurrences.length, 1);
});

test("Vue namespace components diagnose missing exports and complete real aliases", () => {
  const text = `<script setup>import * as Icons from './moeicons';</script><template><Icons.Missing /><Icons.Ui /></template>`;
  const result = analyze(text, "vue");
  assert.equal(result.issues.length, 2);
  const at = text.indexOf("Icons.Ui") + "Icons.Ui".length;
  assert.deepEqual(result.completions(at).map(item => item.name), ["UiSearch"]);
});

test("large documents degrade without creating diagnostics", () => {
  assert.equal(analyze(" ".repeat(500001)).issues.length, 0);
});

test("error catalog is stable, unique, and formats without replacement expansion", () => {
  const map = loadErrorCodes();
  const entry = map.get("UNKNOWN_ICON"); assert.ok(entry);
  assert.throws(() => loadErrorCodes([entry, entry]));
  assert.throws(() => loadErrorCodes([{ ...entry, severity: "bad" }]));
  const formatted = formatIssue({ key: "UNKNOWN_ICON", name: "$&", start: 0, end: 2 });
  assert.ok(formatted.message.includes("'$&'"));
});


test("factory exports are not proposed as JSX components", () => {
  const text = `import * as Icons from './moeicons'; const a = <Icons.createUi />;`;
  const offset = text.indexOf("Icons.createUi") + "Icons.createUi".length;
  assert.equal(analyze(text).completions(offset).length, 0);
});
