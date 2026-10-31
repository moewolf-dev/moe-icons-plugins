#!/usr/bin/env node
import { workflowRunPathMatches } from './workflow-run-path.cjs';
import { verifyExecutionWitness } from './verify-execution-witness.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const env = process.env;
const assert = (value, message) => { if (!value) throw new Error(message); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const record = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const canonicalBytes = value => Buffer.from(`${JSON.stringify(canonical(value))}\n`);
const exactKeys = (value, keys, label) => assert(record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label} has unexpected or missing fields`);
const api = path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 }));
const MAX_GENERATOR_JOBS = 300;
const MAX_GENERATOR_JOB_PAGES = 3;
function readGeneratorJobs(producer) {
  const jobs = [];
  let totalCount;
  for (let page = 1; page <= MAX_GENERATOR_JOB_PAGES; page += 1) {
    const result = api(`repos/moewolf-dev/moe-icons-code-library/actions/runs/${producer.runId}/attempts/${producer.runAttempt}/jobs?per_page=100&page=${page}`);
    assert(result && Number.isSafeInteger(result.total_count) && result.total_count >= 0
      && result.total_count <= MAX_GENERATOR_JOBS && Array.isArray(result.jobs) && result.jobs.length <= 100,
    'package-set producer jobs are incomplete or exceed the 300-job bound');
    if (totalCount === undefined) totalCount = result.total_count;
    assert(result.total_count === totalCount, 'package-set producer job count changed between pages');
    jobs.push(...result.jobs);
    if (jobs.length >= totalCount) break;
    assert(page < MAX_GENERATOR_JOB_PAGES, 'package-set producer jobs exceed the page bound');
  }
  assert(jobs.length === totalCount, 'package-set producer job listing is incomplete');
  return jobs;
}
const root = resolve(process.argv[2]);
fs.mkdirSync(root, { recursive: true });
for (const name of ['CLI_PUBLISH_HEAD', 'CLI_RELEASE_COMMIT']) assert(/^[a-f0-9]{40}$/.test(env[name] || ''), `${name} invalid`);
assert(/^[1-9]\d*$/.test(env.CLI_PUBLISH_RUN_ID || ''), 'CLI publish run invalid');
assert(/^\d+\.\d+\.\d+$/.test(env.CLI_VERSION || ''), 'CLI version invalid');

const run = api(`repos/moewolf-dev/moe-icons-cli/actions/runs/${env.CLI_PUBLISH_RUN_ID}`);
assert(workflowRunPathMatches(run, '.github/workflows/publish.yml') && run.conclusion === 'success' && run.head_sha === env.CLI_PUBLISH_HEAD, 'CLI producer mismatch');
const commit = api(`repos/moewolf-dev/moe-icons-cli/commits/v${env.CLI_VERSION}`);
assert(commit.sha === env.CLI_RELEASE_COMMIT, 'CLI tag differs from frozen publisher commit');
const release = api(`repos/moewolf-dev/moe-icons-cli/releases/tags/v${env.CLI_VERSION}`);
assert(!release.draft && release.tag_name === `v${env.CLI_VERSION}`, 'CLI release not public');
const pinEntry = api(`repos/moewolf-dev/moe-icons-cli/contents/src/catalog/resource-release.json?ref=${env.CLI_RELEASE_COMMIT}`);
const pin = JSON.parse(Buffer.from(pinEntry.content, 'base64').toString());
const eventId = `resource:${pin.resourceVersion}:cli:${env.CLI_VERSION}`;
const registry = await (await fetch(`https://registry.npmjs.org/@moewolf%2fmoe-icons-cli/${env.CLI_VERSION}`, { redirect: 'error', signal: AbortSignal.timeout(30000) })).json();
assert(registry.dist?.integrity === env.CLI_NPM_INTEGRITY, 'CLI npm integrity mismatch');

// A schema-v2 pin carries both immutable package-set roots. Authenticate their
// original Generator attempt and prove that the published CLI contains the
// exact catalog reconstructed from those same metadata packages.
if (pin.schemaVersion === 2 && pin.packageSets !== undefined) {
  exactKeys(pin, ['schemaVersion', 'resourceVersion', 'sourceCommit', 'generatorCommit', 'sourceDispatchId', 'producer', 'packageSets', 'packageSetResourceDigest', 'packageSetDescriptorSha256', 'catalogSha256', 'appliedAt'], 'package-set resource pin');
  const binding = pin.packageSets;
  exactKeys(binding, ['schemaVersion', 'resourceVersion', 'sourceCommit', 'generatorCommit', 'free', 'pro'], 'package-set root binding');
  assert(binding.schemaVersion === 1 && binding.resourceVersion === pin.resourceVersion && binding.sourceCommit === pin.sourceCommit && binding.generatorCommit === pin.generatorCommit, 'package-set pin binding identity mismatch');
  assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pin.resourceVersion || '') && /^[a-f0-9]{40}$/.test(pin.sourceCommit || '') && /^[a-f0-9]{40}$/.test(pin.generatorCommit || '') && /^[a-f0-9]{64}$/.test(pin.sourceDispatchId || ''), 'package-set resource pin identity invalid');
  for (const tier of ['free', 'pro']) {
    const row = binding[tier];
    exactKeys(row, ['packageSetSha256', 'candidateRootSha256', 'candidateRootBytes'], `${tier} candidate binding`);
    assert(/^[a-f0-9]{64}$/.test(row.packageSetSha256 || '') && /^[a-f0-9]{64}$/.test(row.candidateRootSha256 || '') && Number.isSafeInteger(row.candidateRootBytes) && row.candidateRootBytes > 0 && row.candidateRootBytes <= 1024 * 1024, `${tier} candidate root binding invalid`);
  }
  assert(binding.free.packageSetSha256 !== binding.pro.packageSetSha256, 'Free and Pro package-set identities must differ');
  const producer = pin.producer;
  exactKeys(producer, ['repository', 'workflowPath', 'runId', 'runAttempt', 'headSha'], 'package-set producer');
  assert(producer.repository === 'moewolf-dev/moe-icons-code-library' && producer.workflowPath === '.github/workflows/small-pack-candidate.yml' && /^[1-9]\d*$/.test(String(producer.runId)) && Number.isSafeInteger(producer.runAttempt) && producer.runAttempt > 0 && /^[a-f0-9]{40}$/.test(producer.headSha || ''), 'package-set producer locator invalid');
  const producerRun = api(`repos/moewolf-dev/moe-icons-code-library/actions/runs/${producer.runId}/attempts/${producer.runAttempt}`);
  assert(workflowRunPathMatches(producerRun, '.github/workflows/small-pack-candidate.yml') && producerRun.repository?.full_name === producer.repository && producerRun.head_repository?.full_name === producer.repository && producerRun.head_branch === 'main' && String(producerRun.id) === String(producer.runId) && Number(producerRun.run_attempt) === producer.runAttempt && producerRun.head_sha === producer.headSha && ['workflow_dispatch', 'repository_dispatch'].includes(producerRun.event) && producerRun.display_title === `Source package-set ${pin.sourceCommit} ${pin.sourceDispatchId}`, 'package-set producer run differs from exact Source/Generator binding');
  const jobs = readGeneratorJobs(producer);
  for (const name of ['durable', 'dispatch-free', 'dispatch-pro', 'dispatch-website']) {
    const matches = jobs.filter(job => job.name === name);
    assert(matches.length === 1 && matches[0].conclusion === 'success', `package-set producer job ${name} did not succeed`);
  }
  if (producer.headSha !== pin.generatorCommit) verifyExecutionWitness({ binding, producer, sourceDispatchId: pin.sourceDispatchId, api });
  const descriptorSha256 = sha256(canonicalBytes(binding));
  const resourceDigest = sha256(`moe-icons-package-set-resource-v1\n${pin.resourceVersion}\n${pin.sourceCommit}\n${pin.generatorCommit}\n${binding.free.packageSetSha256}\n${binding.pro.packageSetSha256}\n`);
  assert(pin.packageSetDescriptorSha256 === descriptorSha256 && pin.packageSetResourceDigest === resourceDigest, 'package-set pin digest mismatch');
  assert(env.EVENT_ID === eventId && env.RESOURCE_VERSION === pin.resourceVersion && env.SOURCE_COMMIT === pin.sourceCommit && env.GENERATOR_COMMIT === pin.generatorCommit && env.SOURCE_DISPATCH_ID === pin.sourceDispatchId && env.DESCRIPTOR_SHA256 === descriptorSha256 && env.RESOURCE_DIGEST === resourceDigest && env.PACKAGE_SET_FREE_SHA256 === binding.free.packageSetSha256 && env.PACKAGE_SET_PRO_SHA256 === binding.pro.packageSetSha256, 'CLI package-set delivery differs from the published pin');
  const catalogResponse = await fetch(`https://raw.githubusercontent.com/moewolf-dev/moe-icons-cli/${env.CLI_RELEASE_COMMIT}/src/catalog/catalog.json`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert(catalogResponse.ok && catalogResponse.body, 'published CLI catalog is unavailable');
  const declared = catalogResponse.headers.get('content-length');
  if (declared !== null) assert(/^\d+$/.test(declared) && Number(declared) <= 32 * 1024 * 1024, 'published CLI catalog exceeds its byte budget');
  const reader = catalogResponse.body.getReader(), catalogParts = [];
  let catalogLength = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      catalogLength += part.value.byteLength;
      assert(catalogLength <= 32 * 1024 * 1024, 'published CLI catalog exceeds its byte budget');
      catalogParts.push(Buffer.from(part.value));
    }
  } catch (error) { try { await reader.cancel(error); } catch { /* keep the validation error */ } throw error; }
  const catalogBytes = Buffer.concat(catalogParts, catalogLength);
  assert(sha256(catalogBytes) === pin.catalogSha256, 'published CLI catalog digest differs from its package-set pin');
  const catalog = JSON.parse(catalogBytes.toString('utf8'));
  assert(catalog.catalogVersion === pin.resourceVersion && catalog.sourceVersion === pin.resourceVersion && catalog.sourceCommit === pin.sourceCommit && catalog.generatorCommit === pin.generatorCommit && catalog.manifestSchemaVersion === 2, 'published CLI catalog identity differs from the package-set pin');
  assert(env.GH_TOKEN, 'read-only code-library Actions token is required to authenticate the package-set producer');
  const state = JSON.parse(fs.readFileSync('data/release-state.json', 'utf8'));
  assert(state.schemaVersion === 1 && state.current && /^\d+\.\d+\.\d+$/.test(state.current.cliVersion || ''), 'current plugin CLI baseline is invalid');
  const event = {
    schemaVersion: 1,
    eventId,
    sourceRepository: 'moewolf-dev/moe-icons-code-library',
    sourceVersion: pin.resourceVersion,
    sourceCommit: pin.sourceCommit,
    cliVersion: env.CLI_VERSION,
    resourceVersion: pin.resourceVersion,
    resourceDigest,
    descriptorSha256,
    verifiedDelivery: true,
    sourceDispatchId: pin.sourceDispatchId,
    packageSets: binding,
    producer,
  };
  fs.writeFileSync(join(root, 'package-set-binding.json'), `${JSON.stringify(binding, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(join(root, 'event.json'), `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Verified CLI package-set delivery ${eventId}; retaining exact Free/Pro roots`);
} else {
  const state = JSON.parse(fs.readFileSync('data/release-state.json', 'utf8'));
  const accepted = state.events.filter(item => item.phase === 'verified' && item.event.resourceVersion === state.current.resourceVersion).at(-1);
  assert(accepted, 'no verified resource baseline; complete resource release first');
  const identity = accepted.event;
  assert(pin.resourceVersion === env.RESOURCE_VERSION && pin.resourceVersion === identity.resourceVersion && pin.privateDescriptorSha256 === env.DESCRIPTOR_SHA256 && pin.privateDescriptorSha256 === identity.descriptorSha256 && pin.sourceCommit === identity.sourceCommit, 'CLI does not pin the verified resource baseline');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 30000 }).trim();
  assert(git('rev-parse', `${accepted.tag}:data/icons.json`) === git('hash-object', 'data/icons.json'), 'bundled metadata changed from verified resource baseline');
  const request = async url => { const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) }); assert(response.ok, 'published evidence unavailable'); const text = await response.text(); assert(Buffer.byteLength(text) <= 1024 * 1024, 'evidence exceeds size limit'); return JSON.parse(text); };
  const versions = await request('https://api.moeicons.com/v1/icon-library/versions');
  assert(versions.pro?.version === pin.resourceVersion && versions.pro?.descriptorSha256 === pin.privateDescriptorSha256, 'live resource pointer differs from accepted baseline');
  const event = { ...identity, eventId, cliVersion: env.CLI_VERSION };
  fs.writeFileSync(join(root, 'event.json'), `${JSON.stringify(event)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Verified CLI-only delivery ${eventId}; retaining existing resource metadata`);
}

// A publish receipt binds the tag, tarball and integrity to this exact run.
const receipts = join(root, 'receipt');
fs.mkdirSync(receipts);
if (Array.isArray(release.assets) && release.assets.some(asset => asset.name === 'cli-publish-receipt.json')) {
  execFileSync('gh', ['release', 'download', `v${env.CLI_VERSION}`, '--repo', 'moewolf-dev/moe-icons-cli', '--pattern', 'cli-publish-receipt.json', '--dir', receipts], { stdio: 'inherit', timeout: 60000 });
} else execFileSync('gh', ['run', 'download', env.CLI_PUBLISH_RUN_ID, '--repo', 'moewolf-dev/moe-icons-cli', '--pattern', 'cli-publish-receipt-*', '--dir', receipts], { stdio: 'inherit', timeout: 60000 });
const candidates = fs.readdirSync(receipts).flatMap(name => { const path = join(receipts, name); return fs.statSync(path).isDirectory() ? [join(path, 'cli-publish-receipt.json')] : name === 'cli-publish-receipt.json' ? [path] : []; }).filter(path => fs.existsSync(path));
assert(candidates.length === 1 && fs.statSync(candidates[0]).size < 16384, 'ambiguous publisher receipt');
const receipt = JSON.parse(fs.readFileSync(candidates[0], 'utf8'));
assert(receipt.version === env.CLI_VERSION && receipt.releaseCommit === env.CLI_RELEASE_COMMIT && String(receipt.runId) === env.CLI_PUBLISH_RUN_ID && receipt.npmIntegrity === env.CLI_NPM_INTEGRITY && receipt.provenance === true && receipt.conclusion === 'success', 'publisher receipt differs from notification');
assert(env.EVENT_ID === eventId, 'delivery event identity mismatch');
