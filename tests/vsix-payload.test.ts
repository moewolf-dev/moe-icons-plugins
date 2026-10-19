import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

const SCRIPT = "scripts/verify-vsix-payload.py";
const sourceCommit = "a".repeat(40);
const hash = (char: string) => char.repeat(64);
const candidate = (tier: "free" | "pro", setChar: string, rootChar: string) => ({
  tier,
  fullVersion: "1.0.0",
  sourceCommit,
  generatorCommit: "b".repeat(40),
  packageSetSha256: hash(setChar),
  candidateRootSha256: hash(rootChar),
  candidateRootBytes: 300,
});

function baseFiles(): Record<string, Buffer> {
  const free = candidate("free", "c", "d");
  const pro = candidate("pro", "e", "f");
  const packageSets = {
    schemaVersion: 1,
    resourceVersion: "1.0.0",
    sourceCommit,
    generatorCommit: "b".repeat(40),
    free: { packageSetSha256: free.packageSetSha256, candidateRootSha256: free.candidateRootSha256, candidateRootBytes: free.candidateRootBytes },
    pro: { packageSetSha256: pro.packageSetSha256, candidateRootSha256: pro.candidateRootSha256, candidateRootBytes: pro.candidateRootBytes },
  };
  const iconIndex = {
    schemaVersion: 2,
    resourceVersion: "1.0.0",
    sourceCommit,
    candidateSets: { free, pro },
    entries: [{ id: "archive-box", styleGroup: "moe-outline", minimumTier: "free" }],
  };
  const releaseState = {
    schemaVersion: 1,
    current: { pluginVersion: "1.0.0", cliVersion: "1.0.0", resourceVersion: "1.0.0" },
    events: [{ eventId: "resource:1.0.0:cli:1.0.0", pluginVersion: "1.0.0", phase: "versionAllocated", event: { resourceVersion: "1.0.0", sourceCommit, packageSets } }],
  };
  return {
    "[Content_Types].xml": Buffer.from("<Types/>", "utf8"),
    "extension.vsixmanifest": Buffer.from("<PackageManifest/>", "utf8"),
    "extension/package.json": Buffer.from(JSON.stringify({ name: "moe-icons-plugins", version: "1.0.0" })),
    "extension/data/icons.json": Buffer.from(JSON.stringify(iconIndex)),
    "extension/data/release-state.json": Buffer.from(JSON.stringify(releaseState)),
    "extension/dist/extension.js": Buffer.from("module.exports = {};"),
    "extension/dist/engine.js": Buffer.from("module.exports = {};"),
    "extension/moeicons-logo-192x192.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  };
}

function createArchive(root: string, files: Record<string, Buffer>): string {
  const archive = join(root, "fixture.vsix");
  const input = join(root, "files.json");
  writeFileSync(input, JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString("base64")]))));
  const writer = [
    "import base64,json,sys,zipfile",
    "items=json.load(open(sys.argv[2],encoding='utf8'))",
    "with zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_DEFLATED) as z:",
    "  [z.writestr(name,base64.b64decode(payload)) for name,payload in items.items()]",
  ].join("\n");
  execFileSync("python3", ["-c", writer, archive, input]);
  return archive;
}

function audit(archive: string, requirePackageSet = false) {
  return spawnSync("python3", [SCRIPT, ...(requirePackageSet ? ["--require-package-set"] : []), archive], { encoding: "utf8" });
}

function withFixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "moe-icons-vsix-audit-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("VSIX audit accepts the reviewed metadata-only package-set extension inventory", () => {
  withFixture(root => {
    const result = audit(createArchive(root, baseFiles()));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /VSIX payload audit passed:/);
  });
});

test("release mode rejects legacy schema v1 metadata while compatibility audit can inspect it", () => {
  withFixture(root => {
    const files = baseFiles();
    files["extension/data/icons.json"] = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      resourceVersion: "1.0.0",
      sourceCommit,
      sourceDigest: hash("a"),
      entries: [{ id: "archive-box", styleGroup: "moe-outline", minimumTier: "free" }],
    }));
    const archive = createArchive(root, files);
    const compatibility = audit(archive);
    assert.equal(compatibility.status, 0, compatibility.stderr);
    const release = audit(archive, true);
    assert.notEqual(release.status, 0);
    assert.match(release.stderr, /release requires package-set schema v2/);
  });
});

test("release mode rejects invalid or shared Free/Pro candidate roots", () => {
  withFixture(root => {
    const files = baseFiles();
    const index = JSON.parse(files["extension/data/icons.json"].toString("utf8"));
    index.candidateSets.pro.candidateRootBytes = 0;
    files["extension/data/icons.json"] = Buffer.from(JSON.stringify(index));
    const result = audit(createArchive(root, files), true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /candidate binding is invalid/);
  });

  withFixture(root => {
    const files = baseFiles();
    const index = JSON.parse(files["extension/data/icons.json"].toString("utf8"));
    index.candidateSets.pro.packageSetSha256 = index.candidateSets.free.packageSetSha256;
    files["extension/data/icons.json"] = Buffer.from(JSON.stringify(index));
    const result = audit(createArchive(root, files), true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Free and Pro package-set identities must differ/);
  });
});

test("release mode binds candidate roots to the current package-set release event", () => {
  withFixture(root => {
    const files = baseFiles();
    const index = JSON.parse(files["extension/data/icons.json"].toString("utf8"));
    index.candidateSets.free.packageSetSha256 = hash("9");
    files["extension/data/icons.json"] = Buffer.from(JSON.stringify(index));
    const result = audit(createArchive(root, files), true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /roots differ from the accepted release event/);
  });

  withFixture(root => {
    const files = baseFiles();
    const state = JSON.parse(files["extension/data/release-state.json"].toString("utf8"));
    state.current.resourceVersion = "0.9.0";
    files["extension/data/release-state.json"] = Buffer.from(JSON.stringify(state));
    const result = audit(createArchive(root, files), true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /differs from the current release baseline/);
  });
});

test("VSIX audit rejects raw icons and valid nested archives even when renamed", () => {
  withFixture(root => {
    const files = baseFiles();
    files["extension/data/release-state.json"] = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const result = audit(createArchive(root, files));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VSIX contains raw icon data or a nested archive/);
  });

  withFixture(root => {
    const files = baseFiles();
    const nestedZip = join(root, "nested.zip");
    execFileSync("python3", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('icons/archive.png',b'payload'); z.close()", nestedZip]);
    files["extension/data/release-state.json"] = readFileSync(nestedZip);
    const result = audit(createArchive(root, files));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VSIX contains raw icon data or a nested archive/);
  });

  withFixture(root => {
    const files = baseFiles();
    files["extension/data/release-state.json"] = gzipSync(Buffer.from("aggregate icon package fixture"));
    const result = audit(createArchive(root, files));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VSIX contains raw icon data or a nested archive/);
  });
});

test("VSIX audit rejects image files outside the extension logo and oversized renamed payloads", () => {
  withFixture(root => {
    const files = baseFiles();
    files["extension/assets/moe-outline/archive.svg"] = Buffer.from("<svg/>", "utf8");
    const result = audit(createArchive(root, files));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the reviewed extension inventory/);
  });

  withFixture(root => {
    const files = baseFiles();
    files["extension/data/release-state.json"] = Buffer.alloc(16 * 1024 * 1024 + 1, 0x61);
    const result = audit(createArchive(root, files));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /empty or oversized file|expanded package budget/);
  });
});

test("VSIX audit rejects embedded image data in the icon index", () => {
  withFixture(root => {
    const files = baseFiles();
    files["extension/data/icons.json"] = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      resourceVersion: "1.0.0",
      sourceCommit,
      sourceDigest: hash("a"),
      entries: [{ id: "archive-box", styleGroup: "moe-outline", minimumTier: "free", payload: "data:image/png;base64,AA==" }],
    }));
    const result = audit(createArchive(root, files));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /embedded payload data or remote URLs/);
  });
});

test("release workflow audits the actual VSIX before preserving or uploading it", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const validateAt = workflow.indexOf("npm run release:validate");
  const sourceDateAt = workflow.indexOf("export SOURCE_DATE_EPOCH");
  const packAt = workflow.indexOf("npx --no-install vsce package");
  const auditAt = workflow.indexOf("verify-vsix-payload.py --require-package-set");
  const releaseCheckAt = workflow.indexOf("gh api repos/moewolf-dev/moe-icons-plugins/releases");
  const uploadAt = workflow.indexOf("uses: actions/upload-artifact");
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
  assert.match(scripts["release:validate"] ?? "", /verify-small-pack-pin\.mjs/);
  assert.ok(validateAt >= 0 && validateAt < sourceDateAt && sourceDateAt < packAt && packAt >= 0 && auditAt > packAt && releaseCheckAt > auditAt && uploadAt > auditAt);
  assert.match(workflow, /git log -1 --format=%ct/);
});
