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
    await mkdir(join(root, "src/language"), { recursive: true });
    await copyFile("src/language/naming.cjs", join(root, "src/language/naming.cjs"));
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
    const proCatalog = JSON.stringify({ ...JSON.parse(catalog), styleGroups: [...JSON.parse(catalog).styleGroups, { id: "moe-3d-metal", type: "bitmap", tiers: ["pro"], formats: ["png", "webp"], variants: ["moe-3d-metal-256-png", "moe-3d-metal-256-webp"] }], icons: [{ id: "ui-search", targets: ["react", "vue", "assets"], availableIn: ["moe-3d-metal"] }] });
    const descriptorValue = JSON.parse(descriptor);
    descriptorValue.pro.metadata.files["catalog.json"].sha256 = hash(proCatalog);
    descriptorValue.bitmapShards = ["png", "webp"].map(format => ({ tier: "pro", styleGroupId: "moe-3d-metal", resourceVersion: "0.0.18", format, imageSize: { width: 256, height: 256 }, manifestSha256: "c".repeat(64) }));
    const bitmapDescriptor = JSON.stringify(descriptorValue);
    await writeFile(join(root, "pro/catalog.json"), proCatalog);
    await writeFile(join(root, "release-descriptor.json"), bitmapDescriptor);
    await writeFile(join(root, "release-input.json"), JSON.stringify({ schemaVersion: 1, descriptorSha256: hash(bitmapDescriptor), resourceDigest: "b".repeat(64), sourceCommit: "a".repeat(40), resourceVersion: "0.0.18" }));
    await run(process.execPath, [join(root, "scripts/generate-icons-data.mjs"), root]);
    const bitmapOutput = await readFile(join(root, "data/icons.json"), "utf8");
    const variants = JSON.parse(bitmapOutput).entries.filter((entry: { styleGroup: string }) => entry.styleGroup.startsWith("moe-3d-metal"));
    assert.equal(variants.length, 2);
    assert.ok(variants.every((entry: { bindings: { target: string }[] }) => entry.bindings.length === 1 && entry.bindings[0].target === "assets"));
    await rm(join(root, "free/react/moe-outline/index.d.ts"));
    await assert.rejects(run(process.execPath, [join(root, "scripts/generate-icons-data.mjs"), root]), /missing react declarations/);
    assert.equal(await readFile(join(root, "data/icons.json"), "utf8"), bitmapOutput);
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
    const delivery = { ...event, eventId: 'delivery:0.0.19:0.0.4', sourceVersion: '0.0.19', resourceVersion: '0.0.19', cliVersion: '0.0.4', verifiedDelivery: true };
    await writeFile(eventFile, JSON.stringify(delivery));
    assert.equal(JSON.parse((await run(process.execPath, args)).stdout).pluginVersion, '0.0.3');
    assert.equal(JSON.parse((await run(process.execPath, args)).stdout).duplicate, true);
    await writeFile(eventFile, JSON.stringify({ ...delivery, cliVersion: '0.0.5' }));
    await assert.rejects(run(process.execPath, args), /different payload/);
    await writeFile(eventFile, JSON.stringify({ ...delivery, eventId: 'delivery:backwards', sourceVersion: '0.0.20', resourceVersion: '0.0.20', cliVersion: '0.0.3' }));
    await assert.rejects(run(process.execPath, args), /cannot move backwards/);
    await writeFile(eventFile, JSON.stringify(delivery));
    const repair = { ...delivery, eventId: 'delivery:0.0.19:0.0.5', cliVersion: '0.0.5' };
    await writeFile(eventFile, JSON.stringify(repair));
    await assert.rejects(run(process.execPath, args), /verified resource identity/);
    for (const phase of ['packaged','published','verified']) await run(process.execPath, [join(root, 'scripts/release-state.mjs'), 'mark', delivery.eventId, phase]);
    await writeFile(eventFile, JSON.stringify({ ...repair, descriptorSha256: 'f'.repeat(64) }));
    await assert.rejects(run(process.execPath, args), /verified resource identity/);
    await writeFile(eventFile, JSON.stringify(repair));
    assert.equal(JSON.parse((await run(process.execPath, args)).stdout).pluginVersion, '0.0.4');
    assert.equal(JSON.parse((await run(process.execPath, args)).stdout).duplicate, true);
    for (const phase of ['packaged','published','verified']) await run(process.execPath, [join(root, 'scripts/release-state.mjs'), 'mark', repair.eventId, phase]);
    // Source-only plugin patches can advance the plugin version without a delivery event.
    const statePath = join(root, 'data/release-state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.current.pluginVersion = '0.0.5';
    await writeFile(statePath, JSON.stringify(state));
    const mapPath = join(root, 'data/version-map.json');
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    map.history.push({ ...map.history.at(-1), pluginVersion: '0.0.5' });
    await writeFile(mapPath, JSON.stringify(map));
    for (const file of ['package.json', 'package-lock.json']) {
      const path = join(root, file), value = JSON.parse(await readFile(path, 'utf8'));
      value.version = '0.0.5';
      if (value.packages?.['']) value.packages[''].version = '0.0.5';
      await writeFile(path, JSON.stringify(value));
    }
    await writeFile(eventFile, JSON.stringify({ ...repair, eventId: 'delivery:0.0.19:0.0.6', cliVersion: '0.0.6' }));
    assert.equal(JSON.parse((await run(process.execPath, args)).stdout).pluginVersion, '0.0.6');
    await mkdir(join(root, ".release-state-lock"));
    await writeFile(join(root, ".release-state-lock/owner.json"), JSON.stringify({ pid: process.pid }));
    await assert.rejects(run(process.execPath, args), /another release operation is running/);
    assert.equal(JSON.parse(await readFile(files[0].path, "utf8")).version, '0.0.6');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('plugin artifact extraction retains metadata only and rejects altered archives and links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moe-plugin-artifact-'));
  try {
    const fixture = `
import io,json,tarfile,zipfile,hashlib,sys
from pathlib import Path
root=Path(sys.argv[1]); refs={}
for tier in ('free','pro'):
 data=io.BytesIO()
 with tarfile.open(fileobj=data,mode='w:gz') as tar:
  for name,payload in [('catalog.json',b'{}'),('assets/manifest.json',b'{}'),('react/moe-outline/index.d.ts',b'export {}'),('assets/image.png',b'x'*3000000)]:
   entry=tarfile.TarInfo(name);entry.size=len(payload);tar.addfile(entry,io.BytesIO(payload))
  if sys.argv[2]=='link':
   entry=tarfile.TarInfo('assets/link');entry.type=tarfile.SYMTYPE;entry.linkname='/etc/passwd';tar.addfile(entry)
 payload=data.getvalue(); name=f'moe-icons-{tier}-0.0.19.tgz'
 (root/name).write_bytes(payload);refs[tier]={'filename':name,'size':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}
descriptor=json.dumps(dict(fullVersion='0.0.19',sourceCommit='a'*40,generatorCommit='b'*40,**refs)).encode()
with zipfile.ZipFile(root/'artifact.zip','w') as archive:
 archive.writestr('release-descriptor.json',descriptor)
 for ref in refs.values():
  payload=(root/ref['filename']).read_bytes()
  archive.writestr(ref['filename'],payload if sys.argv[2]!='corrupt' else payload+b'changed')
print(hashlib.sha256(descriptor).hexdigest())
`;
    const check = async (mode: string) => {
      const generated = await run('python3', ['-c', fixture, root, mode]);
      const out = join(root, `out-${mode}`); await mkdir(out);
      return run('python3', ['scripts/extract-resource-input.py', join(root, 'artifact.zip'), out], { env: { ...process.env, RESOURCE_VERSION: '0.0.19', SOURCE_COMMIT: 'a'.repeat(40), GENERATOR_COMMIT: 'b'.repeat(40), DESCRIPTOR_SHA256: generated.stdout.trim() } });
    };
    await check('valid');
    assert.equal(await readFile(join(root,'out-valid/pro/react/moe-outline/index.d.ts'),'utf8'),'export {}');
    await assert.rejects(readFile(join(root,'out-valid/pro/assets/image.png')),/ENOENT/);
    await assert.rejects(check('corrupt'),/size mismatch|SHA mismatch/);
    await assert.rejects(check('link'),/non-regular tar entry/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('plugin version/tag is reused on retry and changed same-version metadata is refused', async () => {
  const root=await mkdtemp(join(tmpdir(),'moe-plugin-commit-'));
  try {
    await mkdir(join(root,'scripts'));await mkdir(join(root,'data'));
    await copyFile('scripts/commit-resource-update.mjs',join(root,'scripts/commit-resource-update.mjs'));
    const event={eventId:'delivery:0.0.19:cli:0.0.5',descriptorSha256:'a'.repeat(64),cliVersion:'0.0.5'};
    const record={eventId:event.eventId,event,pluginVersion:'0.0.8',phase:'versionAllocated'};
    for(const [name,value] of Object.entries({'data/release-state.json':{current:{pluginVersion:'0.0.8'},events:[record]},'data/icons.json':{entries:[],largeMetadata:'x'.repeat(2*1024*1024)},'data/version-map.json':[],'package.json':{version:'0.0.8'},'package-lock.json':{version:'0.0.8'}}))await writeFile(join(root,name),JSON.stringify(value));
    await writeFile(join(root,'event.json'),JSON.stringify(event));
    const git=(...args:string[])=>run('git',args,{cwd:root});
    await git('init','-b','main');await git('config','user.name','audit');await git('config','user.email','audit@example.test');
    await git('add','.');await git('commit','-m','allocated');await git('init','--bare',join(root,'remote.git'));await git('remote','add','origin',join(root,'remote.git'));
    const execute=()=>run(process.execPath,['scripts/commit-resource-update.mjs','event.json'],{cwd:root,env:{...process.env,GITHUB_OUTPUT:join(root,'outputs')}});
    await execute();const tag=(await git('rev-parse','v0.0.8^{commit}')).stdout;
    await execute();assert.equal((await git('rev-parse','v0.0.8^{commit}')).stdout,tag);
    await writeFile(join(root,'data/icons.json'),JSON.stringify({entries:['changed']}));
    await assert.rejects(execute(),/same-version replacement/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('publication waits for exact tag workflow and streams the final Marketplace digest', async () => {
  const root=await mkdtemp(join(tmpdir(),'moe-plugin-publication-'));
  try {
    await mkdir(join(root,'scripts'));await mkdir(join(root,'bin'));
    await copyFile('scripts/publish-resource-update.mjs',join(root,'scripts/publish-resource-update.mjs'));
    await writeFile(join(root,'package.json'),JSON.stringify({name:'moe-icons-plugins',publisher:'moewolf',version:'0.0.8'}));
    const payload='bounded reviewed VSIX fixture'.repeat(100000),digest=hash(payload);
    await writeFile(join(root,'fixture'),payload);
    await writeFile(join(root,'bin/gh'),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);
if(args[0]==='api')console.log(JSON.stringify({workflow_runs:[{id:321,event:'workflow_dispatch',display_title:'Plugin publication v0.0.8',created_at:new Date().toISOString(),status:'completed',conclusion:'success',html_url:'https://github.com/moewolf-dev/moe-icons-plugins/actions/runs/321'}]}));
if(args[0]==='release')fs.writeFileSync(path.join(args[args.indexOf('--dir')+1],'vsix.sha256'),process.env.FIXTURE_DIGEST+'  moe-icons-plugins-0.0.8.vsix\\n');
`,{mode:0o755});
    await writeFile(join(root,'bin/curl'),`#!/usr/bin/env node
require('node:fs').createReadStream(process.env.FIXTURE_FILE).pipe(process.stdout);
`,{mode:0o755});
    await run(process.execPath,['scripts/publish-resource-update.mjs'],{cwd:root,timeout:15000,env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,RUNNER_TEMP:root,GITHUB_RUN_ID:'123',RELEASE_TAG:'v0.0.8',EVENT_ID:'resource:0.0.19:cli:0.0.5',RESOURCE_VERSION:'0.0.19',CLI_VERSION:'0.0.5',DESCRIPTOR_SHA256:'a'.repeat(64),FIXTURE_DIGEST:digest,FIXTURE_FILE:join(root,'fixture')}});
    const receipt=JSON.parse(await readFile(join(root,'plugin-readback-123/plugin-publication-receipt.json'),'utf8'));
    assert.equal(receipt.marketplaceVerified,true);assert.equal(receipt.vsixSha256,digest);assert.equal(receipt.runId,'321');assert.equal(receipt.resourceVersion,'0.0.19');
  } finally {await rm(root,{recursive:true,force:true});}
});


test("resource receiver reads bounded nested dispatch provenance", async () => {
  const workflow = await readFile(".github/workflows/resource-update.yml", "utf8");
  assert.match(workflow, /run-name: Plugin resource \$\{\{ github\.event\.client_payload\.eventId/);
  for (const name of ["eventId", "resourceVersion", "sourceCommit", "generatorCommit", "cliVersion", "cliPublishRunId", "cliPublishHead", "cliNpmIntegrity", "descriptorSha256", "productionArtifactId", "upstreamRunId", "upstreamRunAttempt"])
    assert.ok(workflow.includes(`github.event.client_payload.delivery.${name}`), `missing nested ${name}`);
});
