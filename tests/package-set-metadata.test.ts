import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const candidateTools = require("../scripts/vendor/candidate-set.cjs");
const pinScript = resolve("scripts/verify-small-pack-pin.mjs");
const metadataModule = import("../scripts/package-set-metadata.mjs") as Promise<{
  fetchPackageSetMetadata(input: Record<string, unknown>): Promise<Record<string, any>>;
}>;
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const version = "1.2.3";
const sourceCommit = "a".repeat(40);
const generatorCommit = "b".repeat(40);
const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

test("vendored candidate parsers are pinned to a full Generator commit and exact file bytes", () => {
  const source = join(process.cwd(), "scripts", "vendor");
  const root = mkdtempSync(join(tmpdir(), "plugin-small-pack-pin-"));
  const vendor = join(root, "scripts", "vendor");
  mkdirSync(vendor, { recursive: true });
  try {
    for (const name of ["PIN.json", "candidate-set.cjs", "candidate-set-v1.schema.json", "tar-read.cjs"]) copyFileSync(join(source, name), join(vendor, name));
    const policySource = join(source, "moe-icons-release-policy");
    const policyVendor = join(vendor, "moe-icons-release-policy");
    mkdirSync(policyVendor);
    for (const name of ["PIN.json", "free-style-groups.v1.json"]) copyFileSync(join(policySource, name), join(policyVendor, name));
    const run = () => spawnSync(process.execPath, [pinScript, root], { encoding: "utf8" });
    assert.equal(run().status, 0);
    const pinPath = join(vendor, "PIN.json");
    const pin = JSON.parse(readFileSync(pinPath, "utf8"));
    pin.sourceCommit = "97864314e8cd4080e46443edb7abd398066042ba".slice(0, 8);
    writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
    assert.notEqual(run().status, 0, "an abbreviated source commit must not pass the pin gate");
    copyFileSync(join(source, "PIN.json"), pinPath);
    const candidatePath = join(vendor, "candidate-set.cjs");
    const candidateBytes = readFileSync(candidatePath);
    candidateBytes[0] ^= 1;
    writeFileSync(candidatePath, candidateBytes);
    assert.notEqual(run().status, 0, "changed vendored parser bytes must not pass the pin gate");
    copyFileSync(join(source, "candidate-set.cjs"), candidatePath);
    writeFileSync(join(vendor, "candidate-set-v1.schema.json"), "{}\n");
    assert.notEqual(run().status, 0, "changed vendored schema bytes must not pass the pin gate");
    copyFileSync(join(source, "candidate-set-v1.schema.json"), join(vendor, "candidate-set-v1.schema.json"));
    writeFileSync(join(policyVendor, "free-style-groups.v1.json"), "{}\n");
    assert.notEqual(run().status, 0, "changed release policy bytes must not pass the pin gate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Plugins consumer rejects cross-page digest aliases and unresolved dependency references", () => {
  const digest = "f".repeat(64);
  const first = { kind: "svg", tier: "free", styleGroupId: "moe-outline", packageSha256: digest, filename: `packages/${digest}.tgz`, resourceKey: "svg/free/moe-outline", fullVersion: version, compressedBytes: 1, expandedBytes: 1, fileCount: 1, dependencies: [] };
  const second = { ...first, styleGroupId: "moe-solid", resourceKey: "svg/free/moe-solid" };
  const pages = [first, second].map(row => candidateTools.canonicalBytes({ schemaVersion: 1, fullVersion: version, tier: "free", packages: [row] }));
  const refs = pages.map((bytes, index) => ({ filename: `package-page-free-${String(index + 1).padStart(4, "0")}.json`, sha256: hash(bytes), sizeBytes: bytes.length, packageCount: 1 }));
  const root = candidateTools.createCandidateSet({ fullVersion: version, tier: "free", sourceCommit, generatorCommit, packagePages: refs });
  const pageMap = Object.fromEntries(refs.map((ref, index) => [ref.filename, pages[index]]));
  assert.throws(() => candidateTools.validatePackagePages(root, pageMap), /duplicate package digest across candidate set/);

  const danglingDigest = "d".repeat(64);
  const dangling = { ...first, styleGroupId: "moe-game-blue", packageSha256: danglingDigest, filename: `packages/${danglingDigest}.tgz`, resourceKey: "svg/free/moe-game-blue", dependencies: ["e".repeat(64)] };
  const danglingPage = candidateTools.canonicalBytes({ schemaVersion: 1, fullVersion: version, tier: "free", packages: [dangling] });
  const danglingRef = { filename: "package-page-free-0001.json", sha256: hash(danglingPage), sizeBytes: danglingPage.length, packageCount: 1 };
  const danglingRoot = candidateTools.createCandidateSet({ fullVersion: version, tier: "free", sourceCommit, generatorCommit, packagePages: [danglingRef] });
  assert.throws(() => candidateTools.validatePackagePages(danglingRoot, { [danglingRef.filename]: danglingPage }), /missing dependency package/);
});

test("package-set receiver verifies the vendored parser pin before producer reads", () => {
  const workflow = readFileSync(".github/workflows/resource-update.yml", "utf8");
  const pinAt = workflow.indexOf("node scripts/verify-small-pack-pin.mjs");
  const producerReadAt = workflow.indexOf("node scripts/verify-package-set-input.mjs");
  assert.ok(pinAt >= 0 && producerReadAt > pinAt);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /update:[\s\S]*?permissions:\n      actions: write\n      contents: write/);
  const recovery = readFileSync(".github/workflows/resource-update-auto-resume.yml", "utf8");
  assert.match(recovery, /^permissions: \{\}$/m);
  assert.match(recovery, /resume:\n[\s\S]*?\n    if: false\n/);
});

test("resource receiver admits package-set releases while keeping aggregate events closed", () => {
  const workflow = readFileSync(".github/workflows/resource-update.yml", "utf8");
  const jobCondition = workflow.match(/^    if: (.+)$/m)?.[1];
  assert.ok(jobCondition, "resource-update must have an explicit job condition");
  const admittedActions = [...jobCondition.matchAll(/github\.event\.action == '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(admittedActions, ["moe-icons-cli-release", "moe-icons-package-set-release"]);
  assert.doesNotMatch(jobCondition, /moe-icons-code-library-release/);
});

function tarEntry(name: string, body: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${body.byteLength.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return Buffer.concat([header, body, Buffer.alloc((512 - body.byteLength % 512) % 512)]);
}

function metadataPackage(tier: "free" | "pro", groupId: string, icons: string[], trailingPaddingBytes = 0) {
  const catalog = {
    schemaVersion: 1,
    styleGroups: [{ id: groupId, type: "outline", tiers: ["free", "pro"], formats: ["svg"], imageSizes: [] }],
    icons: icons.map(id => ({ id, label: id, aliases: [], keywords: [], categories: [], targets: ["react", "vue", "vanilla", "assets"], variants: [groupId], availableIn: [groupId] })),
  };
  const manual = Buffer.from(`# ${tier} ${groupId}\n`);
  const catalogBytes = json(catalog);
  const innerManifest = json({
    schemaVersion: 1,
    tier,
    styleGroupId: groupId,
    targets: ["react", "vue", "vanilla", "assets"],
    dependencies: { react: { react: ">=17.0.0", "react-dom": ">=17.0.0" }, vue: { vue: ">=3.2.0" }, vanilla: {}, assets: {} },
    files: {
      "MANUAL.md": { size: manual.byteLength, sha256: hash(manual) },
      "catalog.json": { size: catalogBytes.byteLength, sha256: hash(catalogBytes) },
    },
  });
  const payload = [
    ["metadata/MANUAL.md", manual],
    ["metadata/catalog.json", catalogBytes],
    ["metadata/manifest.json", innerManifest],
  ] as const;
  const manifestBytes = candidateTools.canonicalBytes({
    schemaVersion: 1,
    kind: "metadata",
    tier,
    styleGroupId: groupId,
    files: payload.map(([path, bytes]) => ({ path, byteSize: bytes.byteLength, sha256: hash(bytes) })).sort((a, b) => a.path.localeCompare(b.path, "en")),
  });
  const files = [["manifest.json", manifestBytes] as const, ...payload];
  const expandedBytes = files.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
  const tar = Buffer.concat([...files.map(([path, bytes]) => tarEntry(path, bytes)), Buffer.alloc(1024 + trailingPaddingBytes)]);
  const archive = gzipSync(tar, { mtime: 0 });
  const digest = hash(archive);
  return {
    archive,
    row: {
      packageSha256: digest,
      filename: `packages/${digest}.tgz`,
      kind: "metadata",
      tier,
      resourceKey: `metadata/${tier}/${groupId}`,
      styleGroupId: groupId,
      fullVersion: version,
      compressedBytes: archive.byteLength,
      expandedBytes,
      fileCount: files.length,
      dependencies: [],
    },
  };
}

function fixture(trailingPaddingBytes = 0, freeGroupId = "moe-outline") {
  const archives = new Map<string, Buffer>();
  const sets: Record<string, any> = {};
  for (const tier of ["free", "pro"] as const) {
    const groups = tier === "free" ? [[freeGroupId, ["archive-box"]]] : [["moe-outline", ["archive-box"]], ["moe-game-blue", ["pixel-sword"]]];
    const rows = groups.map(([group, ids]) => {
      const item = metadataPackage(tier, group as string, ids as string[], trailingPaddingBytes);
      archives.set(item.row.packageSha256, item.archive);
      return item.row;
    });
    // A non-metadata object proves the plugin inventory reader never downloads it.
    const dummy = Buffer.from(`${tier} svg bytes`);
    const dummyDigest = hash(dummy);
    rows.push({ packageSha256: dummyDigest, filename: `packages/${dummyDigest}.tgz`, kind: "svg", tier, resourceKey: `svg/${tier}/moe-outline`, styleGroupId: "moe-outline", fullVersion: version, compressedBytes: dummy.byteLength, expandedBytes: dummy.byteLength, fileCount: 1, dependencies: [] });
    const built = candidateTools.buildCandidateSet({ fullVersion: version, tier, sourceCommit, generatorCommit, packages: rows });
    const root = candidateTools.parseCandidateSet(built.rootBytes);
    const binding = { packageSetSha256: root.packageSetSha256, candidateRootSha256: hash(built.rootBytes), candidateRootBytes: built.rootBytes.byteLength };
    sets[tier] = { built, root, binding };
  }
  const bindings = { schemaVersion: 1, resourceVersion: version, sourceCommit, generatorCommit, free: sets.free.binding, pro: sets.pro.binding };
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : request.toString());
    calls.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const tier = url.pathname.includes("/pro/") ? "pro" : "free";
    if (tier === "pro") assert.equal(new Headers(init?.headers).get("authorization"), "Bearer " + "t".repeat(40));
    else assert.equal(new Headers(init?.headers).get("authorization"), null);
    const set = sets[tier];
    const identity = { schemaVersion: 1, tier, fullVersion: version, sourceCommit, generatorCommit, packageSetSha256: set.binding.packageSetSha256, candidateRootSha256: set.binding.candidateRootSha256, candidateRootBytes: set.binding.candidateRootBytes, updatedAt: "2026-10-17T00:00:00.000Z" };
    if (url.pathname === `/v1/icon-library/${tier}/package-set`) return Response.json(identity);
    if (url.pathname.endsWith("/root")) return new Response(set.built.rootBytes);
    const pageMatch = /\/pages\/(\d+)$/.exec(url.pathname);
    if (pageMatch) return new Response(set.built.pageBytesByName.get(`package-page-${tier}-${Number(pageMatch[1]).toString().padStart(4, "0")}.json`));
    const packageMatch = /\/packages\/([a-f0-9]{64})\.tgz$/.exec(url.pathname);
    if (packageMatch) {
      const archive = archives.get(packageMatch[1]);
      return archive ? new Response(archive) : new Response("not found", { status: 404 });
    }
    return new Response("unexpected request", { status: 404 });
  };
  return { bindings, calls, fetcher, archives };
}

test("fetches exact Free/Pro candidate sets and only verifies scoped metadata packages", async t => {
  const { fetchPackageSetMetadata } = await metadataModule;
  const f = fixture();
  let responseBodyBytes = 0;
  let requestBodyBytes = 0;
  const tierMetrics = { free: { requests: 0, responseBodyBytes: 0, packageReads: 0 }, pro: { requests: 0, responseBodyBytes: 0, packageReads: 0 } };
  const measuringFetcher: typeof fetch = async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : request.toString());
    const tier = url.pathname.includes("/pro/") ? "pro" : "free";
    const response = await f.fetcher(request, init);
    const body = await response.clone().arrayBuffer();
    responseBodyBytes += body.byteLength;
    tierMetrics[tier].requests += 1;
    tierMetrics[tier].responseBodyBytes += body.byteLength;
    if (url.pathname.includes("/package-set/packages/")) tierMetrics[tier].packageReads += 1;
    const requestBody = init?.body;
    if (typeof requestBody === "string") requestBodyBytes += Buffer.byteLength(requestBody);
    else if (requestBody instanceof ArrayBuffer) requestBodyBytes += requestBody.byteLength;
    else if (ArrayBuffer.isView(requestBody)) requestBodyBytes += requestBody.byteLength;
    return response;
  };
  const manifest = await fetchPackageSetMetadata({ bindings: f.bindings, proToken: "t".repeat(40), fetcher: measuringFetcher });
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.candidateSets.free.packageSetSha256, f.bindings.free.packageSetSha256);
  assert.deepEqual(manifest.entries, [
    { id: "pixel-sword", styleGroup: "moe-game-blue", minimumTier: "pro" },
    { id: "archive-box", styleGroup: "moe-outline", minimumTier: "free" },
  ]);
  const downloaded = f.calls.map(url => /\/packages\/([a-f0-9]{64})\.tgz$/.exec(url.pathname)?.[1]).filter(Boolean);
  assert.equal(downloaded.length, 3);
  assert.ok(downloaded.every(digest => f.archives.has(digest!)));
  assert.ok(f.calls.every(url => url.searchParams.get("version") === version));
  assert.ok(f.calls.every(url => url.searchParams.get("packageSetSha256") === f.bindings[url.pathname.includes("/pro/") ? "pro" : "free"].packageSetSha256));
  t.diagnostic(`package-set-network-metrics ${JSON.stringify({ requests: f.calls.length, requestBodyBytes, responseBodyBytes, byTier: tierMetrics })}`);
});

test("Free metadata outside the pinned group allowlist is rejected before Free package downloads", async () => {
  const { fetchPackageSetMetadata } = await metadataModule;
  const f = fixture(0, "moe-game-blue");
  await assert.rejects(fetchPackageSetMetadata({ bindings: f.bindings, proToken: "t".repeat(40), fetcher: f.fetcher }), /outside the pinned allowlist/);
  assert.equal(f.calls.filter(url => url.pathname.includes("/free/package-set/packages/")).length, 0);
});

test("allows bounded tar record padding without weakening the expanded-file inventory", async () => {
  const { fetchPackageSetMetadata } = await metadataModule;
  const f = fixture(4096);
  const manifest = await fetchPackageSetMetadata({ bindings: f.bindings, proToken: "t".repeat(40), fetcher: f.fetcher });
  assert.equal(manifest.entries.length, 2);
  assert.equal(f.calls.filter(url => url.pathname.includes("/packages/")).length, 3);
});

test("rejects Pro-set reads without the workflow credential before issuing requests", async () => {
  const { fetchPackageSetMetadata } = await metadataModule;
  const f = fixture();
  await assert.rejects(fetchPackageSetMetadata({ bindings: f.bindings, fetcher: f.fetcher }), /Pro package-set workflow credential is required/);
  assert.equal(f.calls.length, 0);
});

test("rejects package digest tampering and preserves strict metadata scope", async () => {
  const { fetchPackageSetMetadata } = await metadataModule;
  const f = fixture();
  const original = f.fetcher;
  const corruptFetcher: typeof fetch = async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : request.toString());
    if (url.pathname.includes("/packages/")) return new Response("changed bytes");
    return original(request, init);
  };
  await assert.rejects(fetchPackageSetMetadata({ bindings: f.bindings, proToken: "t".repeat(40), fetcher: corruptFetcher }), /metadata\/free\/moe-outline byte count differs from its binding/);
});
