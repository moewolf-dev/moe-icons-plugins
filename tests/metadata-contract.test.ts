import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectSnapshot, inspectProjectContract } from "../src/language/project";
import type { LanguageTarget } from "../src/language/contracts";
import { MIN_SUPPORTED_CLI_VERSION, type ProjectContract } from "../src/language/metadata";
import { formatContract, projectGuidance, projectContractSteps } from "../src/diagnostics/project";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

interface FixtureOptions {
  readonly schemaVersion?: number;
  readonly cliVersion?: string;
  readonly artifactVersion?: string;
  readonly sourceVersion?: string;
  readonly catalogSchema?: number;
  readonly target?: LanguageTarget;
  readonly catalogText?: string;
  readonly indexText?: string;
  readonly indexHash?: string;
  readonly metadataText?: string;
  readonly outputDir?: string;
  readonly install?: boolean;
  readonly installedCliVersion?: string;
}

async function fixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "moe-metadata-"));
  await mkdir(join(root, ".moeicons"), { recursive: true });
  await mkdir(join(root, "src/moeicons"), { recursive: true });
  const catalog = options.catalogText ?? JSON.stringify({
    schemaVersion: options.catalogSchema ?? 1,
    catalogVersion: options.sourceVersion ?? "0.0.19",
    sourceVersion: options.sourceVersion ?? "0.0.19",
    styleGroups: [],
    icons: [{ id: "archive" }],
  });
  const index = options.indexText ?? "export const Archive = () => null;";
  await writeFile(join(root, ".moeicons/catalog.json"), catalog);
  await writeFile(join(root, "src/moeicons/index.ts"), index);
  if (options.install !== false) {
    const metadata = {
      schemaVersion: options.schemaVersion ?? 1,
      artifactVersion: options.artifactVersion ?? "0.0.19",
      target: options.target ?? "react",
      generatedOutputDir: options.outputDir ?? "src/moeicons",
      catalogSha256: hash(catalog),
      managedFiles: {
        ".moeicons/catalog.json": hash(catalog),
        "src/moeicons/index.ts": options.indexHash ?? hash(index),
      },
      ...(options.cliVersion === undefined ? {} : { cliVersion: options.cliVersion }),
    };
    await writeFile(join(root, ".moeicons/install-metadata.json"), options.metadataText ?? JSON.stringify(metadata));
  } else if (options.metadataText !== undefined) {
    await writeFile(join(root, ".moeicons/install-metadata.json"), options.metadataText);
  }
  if (options.installedCliVersion !== undefined) {
    await mkdir(join(root, "node_modules/@moewolf/moe-icons-cli"), { recursive: true });
    await writeFile(join(root, "node_modules/@moewolf/moe-icons-cli/package.json"), JSON.stringify({ name: "@moewolf/moe-icons-cli", version: options.installedCliVersion }));
  }
  return root;
}

test("records metadata schema, optional CLI version and artifact/resource versions", async () => {
  const root = await fixture({ installedCliVersion: "0.0.11" });
  try {
    const snapshot = await readProjectSnapshot(root);
    assert.equal(snapshot.contract.status, "ready");
    assert.equal(snapshot.version, "0.0.19");
    assert.equal(snapshot.contract.versions.metadataSchema, 1);
    assert.equal(snapshot.contract.versions.catalogSchema, 1);
    assert.equal(snapshot.contract.versions.artifactVersion, "0.0.19");
    assert.equal(snapshot.contract.versions.resourceVersion, "0.0.19");
    assert.equal(snapshot.contract.versions.cliVersion, undefined);
    assert.equal(snapshot.contract.versions.installedCliVersion, "0.0.11");
    assert.equal(snapshot.resolver(join(root, "src/App.tsx"))("./moeicons")?.exports.has("Archive"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("records a CLI version supplied by metadata when present", async () => {
  const root = await fixture({ cliVersion: "0.0.10" });
  try {
    const contract = (await readProjectSnapshot(root)).contract;
    assert.equal(contract.status, "ready");
    assert.equal(contract.versions.cliVersion, "0.0.10");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("distinguishes a missing CLI from a project that was never generated", async () => {
  const empty = await mkdtemp(join(tmpdir(), "moe-no-cli-"));
  const configured = await mkdtemp(join(tmpdir(), "moe-not-generated-"));
  try {
    assert.equal((await readProjectSnapshot(empty)).contract.status, "cliMissing");
    await mkdir(join(configured, ".moeicons"));
    const notGenerated = await readProjectSnapshot(configured);
    assert.equal(notGenerated.contract.status, "notGenerated");
    assert.equal(notGenerated.contract.detail, "metadata-absent");
    assert.equal(notGenerated.modules.size, 0);
    await writeFile(join(configured, "moeicons.config.jsonc"), "{}");
    assert.equal((await inspectProjectContract(configured)).status, "notGenerated");
  } finally {
    await rm(empty, { recursive: true, force: true });
    await rm(configured, { recursive: true, force: true });
  }
});

test("reports invalid metadata separately from explicit schema drift", async () => {
  const invalidJson = await fixture({ metadataText: "{not-json" });
  const metadataDrift = await fixture({ schemaVersion: 2 });
  const catalogDrift = await fixture({ catalogSchema: 2 });
  try {
    const invalid = await readProjectSnapshot(invalidJson);
    assert.equal(invalid.contract.status, "invalidMetadata");
    assert.equal(invalid.contract.detail, "metadata-json");

    const drift = await readProjectSnapshot(metadataDrift);
    assert.equal(drift.contract.status, "schemaDrift");
    assert.equal(drift.contract.versions.metadataSchema, 2);
    assert.equal(drift.contract.detail, "metadata-schema");

    const catalog = await readProjectSnapshot(catalogDrift);
    assert.equal(catalog.contract.status, "schemaDrift");
    assert.equal(catalog.contract.versions.catalogSchema, 2);
    assert.equal(catalog.contract.detail, "catalog-schema");
  } finally {
    await Promise.all([invalidJson, metadataDrift, catalogDrift].map(root => rm(root, { recursive: true, force: true })));
  }
});

test("marks edited catalog and generated exports as stale instead of silently ready", async () => {
  const catalogRoot = await fixture();
  const exportRoot = await fixture();
  try {
    await writeFile(join(catalogRoot, ".moeicons/catalog.json"), JSON.stringify({ schemaVersion: 1, icons: [{ id: "changed" }] }));
    const catalog = await readProjectSnapshot(catalogRoot);
    assert.equal(catalog.contract.status, "staleGenerated");
    assert.equal(catalog.contract.detail, "catalog-hash");
    assert.equal(catalog.modules.size, 0);

    await writeFile(join(exportRoot, "src/moeicons/index.ts"), "export const Archive = () => 'edited';");
    const exports = await readProjectSnapshot(exportRoot);
    assert.equal(exports.contract.status, "staleGenerated");
    assert.equal(exports.contract.detail, "1-generated-files");
    assert.equal(exports.resolver(join(exportRoot, "src/App.tsx"))("./moeicons"), undefined);
  } finally {
    await Promise.all([catalogRoot, exportRoot].map(root => rm(root, { recursive: true, force: true })));
  }
});

test("reports a CLI below the verified minimum but keeps a verified project usable", async () => {
  const root = await fixture({ cliVersion: "0.0.1" });
  try {
    const snapshot = await readProjectSnapshot(root);
    assert.ok(MIN_SUPPORTED_CLI_VERSION > "0.0.1");
    assert.equal(snapshot.contract.status, "cliVersionTooOld");
    assert.equal(snapshot.contract.versions.cliVersion, "0.0.1");
    assert.equal(snapshot.resolver(join(root, "src/App.tsx"))("./moeicons")?.exports.has("Archive"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("re-reading the same project picks up newly generated metadata without reinstalling", async () => {
  const root = await mkdtemp(join(tmpdir(), "moe-refresh-"));
  try {
    await mkdir(join(root, ".moeicons"), { recursive: true });
    assert.equal((await inspectProjectContract(root)).status, "notGenerated");
    await mkdir(join(root, "src/moeicons"), { recursive: true });
    const catalog = JSON.stringify({ schemaVersion: 1, sourceVersion: "0.0.19", icons: [{ id: "archive" }] });
    const index = "export const Archive = () => null;";
    await writeFile(join(root, ".moeicons/catalog.json"), catalog);
    await writeFile(join(root, "src/moeicons/index.ts"), index);
    await writeFile(join(root, ".moeicons/install-metadata.json"), JSON.stringify({
      schemaVersion: 1, artifactVersion: "0.0.19", target: "react", generatedOutputDir: "src/moeicons",
      catalogSha256: hash(catalog),
      managedFiles: { ".moeicons/catalog.json": hash(catalog), "src/moeicons/index.ts": hash(index) },
    }));
    const refreshed = await inspectProjectContract(root);
    assert.equal(refreshed.status, "ready");
    assert.equal(refreshed.versions.resourceVersion, "0.0.19");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("every degraded status maps to a stable code and ordered recovery steps", () => {
  const statuses: Array<Exclude<ProjectContract["status"], "ready">> = ["cliMissing", "notGenerated", "invalidMetadata", "schemaDrift", "staleGenerated", "cliVersionTooOld"];
  for (const status of statuses) {
    const guidance = projectGuidance({ status, versions: {} });
    assert.ok(guidance, status);
    assert.match(guidance.definition.code, /^MOE-ICON-\d{4}$/);
    assert.match(guidance.hint, /Node\.js 24/);
    assert.match(guidance.hint, /moeicons generate/);
    assert.match(guidance.hint, /moeicons doctor/);
    const steps = projectContractSteps({ status, versions: {} });
    assert.equal(steps.length >= 4, true);
    assert.match(steps[0], /Node\.js 24/);
  }
  assert.equal(projectGuidance({ status: "ready", versions: {} }), undefined);
  assert.doesNotMatch(formatContract({ status: "ready", versions: { metadataSchema: 1, artifactVersion: "0.0.19", resourceVersion: "0.0.19" } }), /\//);
});
