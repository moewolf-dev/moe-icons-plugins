import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectSnapshot, proxyName } from "../src/language/project";
import { analyzeDocument } from "../src/language/analyze";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function project(target = "react") {
  const root = await mkdtemp(join(tmpdir(), "moe-language-"));
  await mkdir(join(root, ".moeicons")); await mkdir(join(root, "src/custom-icons/icons"), { recursive: true });
  const catalog = JSON.stringify({ schemaVersion: 1, icons: [{ id: "ui-search" }] });
  const index = target === "vanilla" ? `export * as MoeOutline from './icons';` : `export { UiSearch } from './icons/UiSearch';`;
  const component = target === "vanilla" ? `export { default as uiSearch, createUiSearch } from './UiSearch';` : `export const UiSearch = () => null;`;
  const files = new Map([[".moeicons/catalog.json", catalog], ["src/custom-icons/index.ts", index], [target === "vanilla" ? "src/custom-icons/icons/index.ts" : "src/custom-icons/icons/UiSearch.tsx", component]]);
  if (target === "vanilla") files.set("src/custom-icons/icons/UiSearch.ts", "export default function UiSearch() {}\nexport function createUiSearch() {}\n");
  const metadata = { schemaVersion: 1, artifactVersion: "0.0.18", target, generatedOutputDir: "src/custom-icons", catalogSha256: hash(catalog), managedFiles: Object.fromEntries([...files].map(([path, text]) => [path, hash(text)])) };
  for (const [path, text] of files) await writeFile(join(root, path), text);
  await writeFile(join(root, ".moeicons/install-metadata.json"), JSON.stringify(metadata));
  return { root, metadata };
}

test("verified generated output is authoritative independently of the stale bundled manifest", async () => {
  const { root } = await project();
  try {
    const snapshot = await readProjectSnapshot(root);
    assert.equal(snapshot.version, "0.0.18");
    const resolver = snapshot.resolver(join(root, "src/App.tsx"));
    assert.ok(resolver("./custom-icons")?.complete);
    assert.equal(resolver("moe-icons"), undefined);
    const result = analyzeDocument(`import { UiSearch, Missing } from './custom-icons'; <UiSearch />;`, "typescriptreact", resolver);
    assert.equal(result.occurrences.length, 2); assert.equal(result.issues.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Vanilla namespace exports are resolved from the installed barrel", async () => {
  const { root } = await project("vanilla");
  try {
    const snapshot = await readProjectSnapshot(root);
    const result = analyzeDocument(`import { MoeOutline } from './custom-icons'; MoeOutline.createUiSearch();`, "typescript", snapshot.resolver(join(root, "src/App.ts")));
    assert.equal(result.issues.length, 0); assert.equal(result.occurrences.length, 1);
    assert.equal(result.occurrences[0].symbol.kind, "factory");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("catalog drift and edited generated barrels fail open", async () => {
  const { root } = await project();
  try {
    await writeFile(join(root, "src/custom-icons/index.ts"), `export { UiSearch } from './elsewhere';`);
    assert.equal((await readProjectSnapshot(root)).resolver(join(root, "src/App.tsx"))("./custom-icons"), undefined);
    await writeFile(join(root, ".moeicons/catalog.json"), "{}");
    assert.equal((await readProjectSnapshot(root)).modules.size, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unsafe output directories and symlinks outside the workspace are rejected", async () => {
  const { root, metadata } = await project();
  const outside = await mkdtemp(join(tmpdir(), "moe-outside-"));
  try {
    await writeFile(join(root, ".moeicons/install-metadata.json"), JSON.stringify({ ...metadata, generatedOutputDir: "../outside" }));
    assert.equal((await readProjectSnapshot(root)).modules.size, 0);
    await writeFile(join(root, ".moeicons/install-metadata.json"), JSON.stringify(metadata));
    await writeFile(join(outside, "index.ts"), `export { UiSearch } from './icons/UiSearch';`);
    await rm(join(root, "src/custom-icons/index.ts")); await symlink(join(outside, "index.ts"), join(root, "src/custom-icons/index.ts"));
    assert.equal((await readProjectSnapshot(root)).modules.size, 0);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("canonical naming preserves the real library and CLI rules", () => {
  assert.equal(proxyName("ui-search"), "UiSearch"); assert.equal(proxyName("123-shape"), "Icon123Shape"); assert.equal(proxyName("class"), "IconClass");
});


test("renamed re-exports retain icon identity and changed children lose authority", async () => {
  const { root, metadata } = await project();
  try {
    const index = "export { UiSearch as SearchAlias } from './icons/UiSearch';";
    await writeFile(join(root, "src/custom-icons/index.ts"), index);
    metadata.managedFiles["src/custom-icons/index.ts"] = hash(index);
    await writeFile(join(root, ".moeicons/install-metadata.json"), JSON.stringify(metadata));
    let module = (await readProjectSnapshot(root)).resolver(join(root, "src/App.tsx"))("./custom-icons");
    assert.equal(module?.complete, true);
    assert.equal(module?.exports.get("SearchAlias")?.kind, "component");
    await writeFile(join(root, "src/custom-icons/icons/UiSearch.tsx"), "export const BusinessComponent = () => null;");
    module = (await readProjectSnapshot(root)).resolver(join(root, "src/App.tsx"))("./custom-icons");
    assert.equal(module?.complete, false);
    assert.equal(module?.exports.has("SearchAlias"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("nearest CLI-managed subproject and bounded aliases identify actual installed modules", async () => {
  const { root } = await project();
  try {
    const { findManagedProjectRoot } = await import("../src/language/project");
    await mkdir(join(root, "src/nested"));
    assert.equal(await findManagedProjectRoot(join(root, "src/nested"), root), root);
    assert.equal(await findManagedProjectRoot(root, join(root, "src")), undefined);
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"], "icons": ["src/custom-icons"] } } }));
    const snapshot = await readProjectSnapshot(root);
    const resolver = snapshot.resolver(join(root, "src/App.tsx"));
    assert.equal(resolver("@/custom-icons")?.exports.get("UiSearch")?.iconId, "ui-search");
    assert.ok(resolver("icons"));
    assert.equal(resolver("iconsOther"), undefined);
    assert.equal(resolver("@/../outside"), undefined);
    assert.equal(snapshot.watches(join(root, "src/Business.tsx")), false);
    assert.equal(snapshot.watches(join(root, "src/custom-icons/icons/UiSearch.tsx")), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("large full-package metadata does not force scanning unrelated artifacts", async () => {
  const { root, metadata } = await project("vanilla");
  try {
    for (let i = 0; i < 17000; i++) metadata.managedFiles[`.moeicons/artifact/vanilla/moe-outline/UnusedLongIcon${i}.js`] = hash("unused");
    const text=JSON.stringify(metadata,null,2);
    assert.ok(Buffer.byteLength(text)>2_000_000);
    await writeFile(join(root,".moeicons/install-metadata.json"),text);
    const snapshot=await readProjectSnapshot(root);
    const module=snapshot.resolver(join(root,"src/App.ts"))("./custom-icons");
    assert.ok(module?.complete);
    assert.ok(module?.exports.has("MoeOutline"));
    assert.ok(snapshot.modules.size<10);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('Pro rights follow verified SVG imports and bitmap wrapper imports, not the whole catalog', async () => {
 const {root,metadata}=await project();
 try{
  const catalog=JSON.stringify({schemaVersion:1,styleGroups:[{id:'moe-outline',tiers:['free','pro']},{id:'moe-3d-metal',tiers:['pro']}],icons:[{id:'ui-search'}]});
  const proxy='import {MetalUiSearch} from "../wrappers/MetalUiSearch"; export const UiSearch = () => MetalUiSearch();';
  const wrapper='import asset from "../assets/moe-3d-metal-128-webp/ui-search.webp"; export const MetalUiSearch=()=>asset;';
  await mkdir(join(root,'src/custom-icons/wrappers'),{recursive:true});
  await writeFile(join(root,'.moeicons/catalog.json'),catalog);await writeFile(join(root,'src/custom-icons/icons/UiSearch.tsx'),proxy);await writeFile(join(root,'src/custom-icons/wrappers/MetalUiSearch.tsx'),wrapper);
  await writeFile(join(root,'.moeicons/install-metadata.json'),JSON.stringify({...metadata,catalogSha256:hash(catalog),managedFiles:{...metadata.managedFiles,'.moeicons/catalog.json':hash(catalog),'src/custom-icons/icons/UiSearch.tsx':hash(proxy),'src/custom-icons/wrappers/MetalUiSearch.tsx':hash(wrapper)}}));
  const snapshot=await readProjectSnapshot(root);assert.equal(snapshot.resolver(join(root,'src/App.tsx'))('./custom-icons')?.exports.get('UiSearch')?.kind,'component');
  const symbol=snapshot.resolver(join(root,'src/App.tsx'))('./custom-icons')?.exports.get('UiSearch');assert.ok(symbol?.kind!=='namespace' && symbol?.requiresPro);
 }finally{await rm(root,{recursive:true,force:true});}
});
