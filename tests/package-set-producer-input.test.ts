import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function event() {
  const delivery = {
    schemaVersion: 1,
    sourceDispatchId: "1".repeat(64),
    resourceVersion: "1.2.3",
    sourceCommit: "a".repeat(40),
    generatorCommit: "b".repeat(40),
    producer: { repository: "moewolf-dev/moe-icons-code-library", workflowPath: ".github/workflows/small-pack-candidate.yml", runId: "123", runAttempt: 2, headSha: "b".repeat(40) },
    free: { packageSetSha256: "c".repeat(64), candidateRootSha256: "d".repeat(64), candidateRootBytes: 512 },
    pro: { packageSetSha256: "e".repeat(64), candidateRootSha256: "f".repeat(64), candidateRootBytes: 768 },
  };
  const id = hash(`moe-icons-small-package-plugin-v1\n${delivery.sourceDispatchId}\n${delivery.free.packageSetSha256}\n${delivery.pro.packageSetSha256}\n`);
  delivery.eventId = `package-set:${delivery.resourceVersion}:${id}`;
  return { action: "moe-icons-package-set-release", client_payload: { eventId: delivery.eventId, delivery } };
}

async function makeHarness(t: { after(callback: () => Promise<void>): void }, jobConclusion = "success", displayTitle = `Source package-set ${"a".repeat(40)} ${"1".repeat(64)}`, jobPages: Record<number, any> | null = null) {
  const root = await mkdtemp(join(tmpdir(), "moe-plugin-package-set-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "bin"));
  const ghPath = join(root, "bin/gh");
  await writeFile(ghPath, `#!/usr/bin/env node
const route=process.argv[process.argv.indexOf('api')+1]||'';
const repo='moewolf-dev/moe-icons-code-library', commit='${"b".repeat(40)}';
const pages=${JSON.stringify(jobPages)};
if(route.includes('/jobs?')) { const page=Number(new URL('https://api.test/?'+route.split('?')[1]).searchParams.get('page')); console.log(JSON.stringify(pages?.[page]??{total_count:4,jobs:['durable','dispatch-free','dispatch-pro','dispatch-website'].map(name=>({name,conclusion:'${jobConclusion}'}))})); }
else console.log(JSON.stringify({id:123,run_attempt:2,event:'workflow_dispatch',status:'completed',conclusion:'success',head_sha:commit,head_branch:'main',path:'.github/workflows/small-pack-candidate.yml',display_title:${JSON.stringify(displayTitle)},repository:{full_name:repo},head_repository:{full_name:repo}}));
`, { mode: 0o755 });
  const payloadPath = join(root, "event.json");
  await writeFile(payloadPath, JSON.stringify(event()));
  const envFile = join(root, "github-env");
  await writeFile(envFile, "");
  return { root, payloadPath, envFile, ghPath };
}

test("verifies the exact Generator attempt and writes a root/page binding without artifact payloads", async t => {
  const h = await makeHarness(t);
  const outputRoot = join(h.root, "output");
  await run(process.execPath, ["scripts/verify-package-set-input.mjs", outputRoot], {
    env: { ...process.env, PATH: `${join(h.root, "bin")}:${process.env.PATH}`, GH_TOKEN: "read-token", GITHUB_EVENT_PATH: h.payloadPath, GITHUB_ENV: h.envFile },
  });
  const binding = JSON.parse(await readFile(join(outputRoot, "package-set-binding.json"), "utf8"));
  const ledgerEvent = JSON.parse(await readFile(join(outputRoot, "event.json"), "utf8"));
  assert.equal(binding.resourceVersion, "1.2.3");
  assert.equal(binding.free.packageSetSha256, "c".repeat(64));
  assert.equal(ledgerEvent.cliVersion, JSON.parse(await readFile("data/release-state.json", "utf8")).current.cliVersion);
  assert.match(await readFile(h.envFile, "utf8"), /DESCRIPTOR_SHA256=[a-f0-9]{64}/);
});

test("rejects a candidate producer whose package-set or projection job failed", async t => {
  const h = await makeHarness(t, "failure");
  const outputRoot = join(h.root, "output");
  await assert.rejects(run(process.execPath, ["scripts/verify-package-set-input.mjs", outputRoot], {
    env: { ...process.env, PATH: `${join(h.root, "bin")}:${process.env.PATH}`, GH_TOKEN: "read-token", GITHUB_EVENT_PATH: h.payloadPath, GITHUB_ENV: h.envFile },
  }), /producer job durable did not succeed/);
  await assert.rejects(readFile(join(outputRoot, "event.json")), /ENOENT/);
});

test("finds required producer jobs on page two and rejects a changing job count", async t => {
  const pages = {
    1: { total_count: 104, jobs: Array.from({ length: 100 }, (_, index) => ({ name: `build-unit-${index}` })) },
    2: { total_count: 104, jobs: ["durable", "dispatch-free", "dispatch-pro", "dispatch-website"].map(name => ({ name, conclusion: "success" })) },
  };
  const h = await makeHarness(t, "success", undefined, pages);
  const outputRoot = join(h.root, "output");
  await run(process.execPath, ["scripts/verify-package-set-input.mjs", outputRoot], {
    env: { ...process.env, PATH: `${join(h.root, "bin")}:${process.env.PATH}`, GH_TOKEN: "read-token", GITHUB_EVENT_PATH: h.payloadPath, GITHUB_ENV: h.envFile },
  });
  assert.ok(JSON.parse(await readFile(join(outputRoot, "event.json"), "utf8")));

  const changedPages = {
    1: { total_count: 101, jobs: Array.from({ length: 100 }, (_, index) => ({ name: `build-unit-${index}` })) },
    2: { total_count: 104, jobs: ["durable", "dispatch-free", "dispatch-pro", "dispatch-website"].map(name => ({ name, conclusion: "success" })) },
  };
  const changed = await makeHarness(t, "success", undefined, changedPages);
  await assert.rejects(run(process.execPath, ["scripts/verify-package-set-input.mjs", join(changed.root, "output")], {
    env: { ...process.env, PATH: `${join(changed.root, "bin")}:${process.env.PATH}`, GH_TOKEN: "read-token", GITHUB_EVENT_PATH: changed.payloadPath, GITHUB_ENV: changed.envFile },
  }), /job count changed between pages/);
});

test("rejects a Generator run title bound to another Source commit or dispatch ID", async t => {
  for (const title of [
    `Source package-set ${"9".repeat(40)} ${"1".repeat(64)}`,
    `Source package-set ${"a".repeat(40)} ${"9".repeat(64)}`,
  ]) {
    const h = await makeHarness(t, "success", title);
    await assert.rejects(run(process.execPath, ["scripts/verify-package-set-input.mjs", join(h.root, "output")], {
      env: { ...process.env, PATH: `${join(h.root, "bin")}:${process.env.PATH}`, GH_TOKEN: "read-token", GITHUB_EVENT_PATH: h.payloadPath, GITHUB_ENV: h.envFile },
    }), /exact Source\/Generator binding/);
  }
});

test("CLI-only package-set pin verification reads required Generator jobs from page two", async t => {
  const root = await mkdtemp(join(tmpdir(), "moe-plugin-cli-package-set-title-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "bin"));
  await copyFile("scripts/verify-cli-input.mjs", join(root, "scripts/verify-cli-input.mjs"));
  await copyFile("scripts/workflow-run-path.cjs", join(root, "scripts/workflow-run-path.cjs"));
  await copyFile("scripts/verify-execution-witness.mjs", join(root, "scripts/verify-execution-witness.mjs"));
  await copyFile("scripts/small-pack-consumer-transport.cjs", join(root, "scripts/small-pack-consumer-transport.cjs"));

  const sourceCommit = "a".repeat(40), sourceDispatchId = "1".repeat(64), generatorCommit = "b".repeat(40);
  const binding = {
    schemaVersion: 1, resourceVersion: "1.2.3", sourceCommit, generatorCommit,
    free: { packageSetSha256: "c".repeat(64), candidateRootSha256: "d".repeat(64), candidateRootBytes: 512 },
    pro: { packageSetSha256: "e".repeat(64), candidateRootSha256: "f".repeat(64), candidateRootBytes: 768 },
  };
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const descriptorSha256 = hash(`${JSON.stringify(canonical(binding))}\n`);
  const resourceDigest = hash(`moe-icons-package-set-resource-v1\n1.2.3\n${sourceCommit}\n${generatorCommit}\n${binding.free.packageSetSha256}\n${binding.pro.packageSetSha256}\n`);
  const catalog = { catalogVersion: "1.2.3", sourceVersion: "1.2.3", sourceCommit, generatorCommit, manifestSchemaVersion: 2 };
  const catalogBytes = Buffer.from(JSON.stringify(catalog));
  const pin = {
    schemaVersion: 2, resourceVersion: "1.2.3", sourceCommit, generatorCommit, sourceDispatchId,
    producer: { repository: "moewolf-dev/moe-icons-code-library", workflowPath: ".github/workflows/small-pack-candidate.yml", runId: "456", runAttempt: 2, headSha: generatorCommit },
    packageSets: binding, packageSetResourceDigest: resourceDigest, packageSetDescriptorSha256: descriptorSha256,
    catalogSha256: hash(catalogBytes.toString("utf8")), appliedAt: "2026-10-18T00:00:00.000Z",
  };
  await writeFile(join(root, "data/release-state.json"), JSON.stringify({ schemaVersion: 1, current: { cliVersion: "0.0.14" }, events: [] }));
  const ghConfig = {
    pinContent: Buffer.from(JSON.stringify(pin)).toString("base64"),
    producerRun: { id: 456, run_attempt: 2, repository: { full_name: "moewolf-dev/moe-icons-code-library", private: true },
      head_repository: { full_name: "moewolf-dev/moe-icons-code-library" }, event: "workflow_dispatch", head_branch: "main",
      path: ".github/workflows/small-pack-candidate.yml", display_title: `Source package-set ${sourceCommit} ${sourceDispatchId}`,
      head_sha: generatorCommit },
  };
  await writeFile(join(root, "bin/gh"), `#!${process.execPath}
const f=${JSON.stringify(ghConfig)}, route=process.argv[2]==='api'?process.argv[3]:'';
let out;
if(process.argv[2]==='run'&&process.argv[3]==='download') { const directory=process.argv[process.argv.indexOf('--dir')+1]; require('node:fs').writeFileSync(require('node:path').join(directory,'cli-publish-receipt.json'),JSON.stringify({version:'0.0.7',releaseCommit:'${"c".repeat(40)}',runId:'123',npmIntegrity:'sha512-fixture',provenance:true,conclusion:'success'})); process.exit(0); }
if(route==='repos/moewolf-dev/moe-icons-cli/actions/runs/123')out={path:'.github/workflows/publish.yml',conclusion:'success',head_sha:'${"d".repeat(40)}'};
else if(route==='repos/moewolf-dev/moe-icons-cli/commits/v0.0.7')out={sha:'${"c".repeat(40)}'};
else if(route==='repos/moewolf-dev/moe-icons-cli/releases/tags/v0.0.7')out={draft:false,tag_name:'v0.0.7'};
else if(route.startsWith('repos/moewolf-dev/moe-icons-cli/contents/src/catalog/resource-release.json'))out={content:f.pinContent};
else if(route==='repos/moewolf-dev/moe-icons-code-library/actions/runs/456/attempts/2')out=f.producerRun;
else if(route.endsWith('/actions/runs/456/attempts/2/jobs?per_page=100&page=1'))out={total_count:104,jobs:Array.from({length:100},(_,index)=>({name:'build-unit-'+index,conclusion:'success'}))};
else if(route.endsWith('/actions/runs/456/attempts/2/jobs?per_page=100&page=2'))out={total_count:104,jobs:['durable','dispatch-free','dispatch-pro','dispatch-website'].map(name=>({name,conclusion:'success'}))};
else throw new Error('unexpected route '+route);
console.log(JSON.stringify(out));
`, { mode: 0o755 });
  await writeFile(join(root, "preload.mjs"), `const bytes=Buffer.from(${JSON.stringify(catalogBytes.toString("base64"))},'base64');
globalThis.fetch=async url=>String(url).includes('registry.npmjs.org')?Response.json({dist:{integrity:'sha512-fixture'}}):String(url).includes('raw.githubusercontent.com')?new Response(bytes):new Response(null,{status:404});
`);
  const env = {
    ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_TOKEN: "read-token",
    CLI_VERSION: "0.0.7", CLI_RELEASE_COMMIT: "c".repeat(40), CLI_PUBLISH_HEAD: "d".repeat(40), CLI_PUBLISH_RUN_ID: "123",
    RESOURCE_VERSION: "1.2.3", SOURCE_COMMIT: sourceCommit, GENERATOR_COMMIT: generatorCommit, SOURCE_DISPATCH_ID: sourceDispatchId,
    DESCRIPTOR_SHA256: descriptorSha256, RESOURCE_DIGEST: resourceDigest,
    PACKAGE_SET_FREE_SHA256: binding.free.packageSetSha256, PACKAGE_SET_PRO_SHA256: binding.pro.packageSetSha256,
    CLI_NPM_INTEGRITY: "sha512-fixture", EVENT_ID: "resource:1.2.3:cli:0.0.7",
  };
  await run(process.execPath, ["--import", join(root, "preload.mjs"), "scripts/verify-cli-input.mjs", join(root, "output")], {
    cwd: root, env,
  });
  const accepted = JSON.parse(await readFile(join(root, "output/event.json"), "utf8"));
  assert.equal(accepted.producer.runId, "456");
  assert.equal(accepted.sourceDispatchId, sourceDispatchId);
});
