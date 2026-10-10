import {retrieve} from './durable-release-artifact.cjs';
import { workflowRunPathMatches } from './workflow-run-path.cjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const env = process.env;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const api = route => JSON.parse(execFileSync('gh', ['api', route], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 }));
async function publicJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error', headers: { 'User-Agent': 'moe-icons-plugin-release' } });
  assert(response.ok && response.body, 'public release evidence unavailable');
  const chunks=[]; let size=0; const reader=response.body.getReader();
  try { for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length; assert(size<=1024*1024,'public JSON exceeds budget'); chunks.push(Buffer.from(value)); } }
  catch(error) { await reader.cancel(); throw error; }
  return JSON.parse(Buffer.concat(chunks).toString());
}
const root = resolve(process.argv[2]);
fs.mkdirSync(root, { recursive: true });
for (const name of ['SOURCE_COMMIT','GENERATOR_COMMIT','CLI_PUBLISH_HEAD']) assert(/^[a-f0-9]{40}$/.test(env[name] || ''), `${name} invalid`);
for (const name of ['CLI_PUBLISH_RUN_ID','UPSTREAM_RUN_ID','UPSTREAM_RUN_ATTEMPT']) assert(/^[1-9]\d*$/.test(env[name] || ''), `${name} invalid`);
for (const name of ['RESOURCE_VERSION','CLI_VERSION']) assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(env[name] || ''), `${name} invalid`);
for (const name of ['DESCRIPTOR_SHA256','RESOURCE_DIGEST']) assert(/^[a-f0-9]{64}$/.test(env[name] || ''), `${name} invalid`);
assert(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(env.EVENT_ID || ''), 'event ID invalid');
assert(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(env.CLI_NPM_INTEGRITY || ''), 'CLI npm integrity invalid');
const artifactId = env.PRODUCTION_ARTIFACT_ID;
assert(/^[1-9]\d*$/.test(artifactId || ''), 'invalid production artifact id');
const repository = 'moewolf-dev/moe-icons-code-library';
const artifact = await retrieve({id:artifactId,version:env.RESOURCE_VERSION,runId:env.UPSTREAM_RUN_ID,attempt:env.UPSTREAM_RUN_ATTEMPT,headSha:env.GENERATOR_COMMIT},join(root,'artifact.zip'));
assert(String(artifact.id) === artifactId && !artifact.expired && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 2 * 1024 ** 3, 'artifact size/identity/expiry invalid');
assert(/^sha256:[a-f0-9]{64}$/.test(artifact.digest || ''), 'artifact ZIP digest missing');
assert(String(artifact.workflow_run?.id) === env.UPSTREAM_RUN_ID && artifact.workflow_run?.head_sha === env.GENERATOR_COMMIT, 'artifact producer does not match accepted release');
const producer = api(`repos/${repository}/actions/runs/${env.UPSTREAM_RUN_ID}/attempts/${env.UPSTREAM_RUN_ATTEMPT}`);
assert(workflowRunPathMatches(producer, '.github/workflows/production-pack.yml') && producer.head_sha === env.GENERATOR_COMMIT && String(producer.run_attempt) === env.UPSTREAM_RUN_ATTEMPT, 'producer workflow/attempt mismatch');
// Acceptance may still be running while the immutable pack job is completed.
const jobs = api(`repos/${repository}/actions/runs/${env.UPSTREAM_RUN_ID}/attempts/${env.UPSTREAM_RUN_ATTEMPT}/jobs?per_page=100`).jobs;
assert(jobs.some(job => job.name === 'pack' && job.conclusion === 'success'), 'immutable production pack did not succeed');
const cliRun = await publicJson(`https://api.github.com/repos/moewolf-dev/moe-icons-cli/actions/runs/${env.CLI_PUBLISH_RUN_ID}`);
assert(workflowRunPathMatches(cliRun, '.github/workflows/publish.yml') && cliRun.conclusion === 'success' && cliRun.head_sha === env.CLI_PUBLISH_HEAD, 'CLI publisher identity invalid');
const cliRelease = await publicJson(`https://api.github.com/repos/moewolf-dev/moe-icons-cli/releases/tags/v${env.CLI_VERSION}`);
assert(!cliRelease.draft && cliRelease.tag_name === `v${env.CLI_VERSION}`, 'CLI release not published');
const registry = await publicJson(`https://registry.npmjs.org/@moewolf%2fmoe-icons-cli/${env.CLI_VERSION}`);
assert(registry.dist?.integrity === env.CLI_NPM_INTEGRITY, 'registry CLI integrity differs from accepted publisher');
const zip = join(root, 'artifact.zip');
try {
  execFileSync('python3', ['scripts/extract-resource-input.py', zip, root], { stdio: 'inherit', timeout: 10 * 60 * 1000 });
} finally { fs.rmSync(zip, { force: true }); }
fs.writeFileSync(join(root, 'release-input.json'), JSON.stringify({ schemaVersion: 1, descriptorSha256: env.DESCRIPTOR_SHA256, resourceDigest: env.RESOURCE_DIGEST, sourceCommit: env.SOURCE_COMMIT, resourceVersion: env.RESOURCE_VERSION }) + '\n');
fs.writeFileSync(join(root, 'event.json'), JSON.stringify({ schemaVersion: 1, eventId: env.EVENT_ID, sourceRepository: repository, sourceVersion: env.RESOURCE_VERSION, sourceCommit: env.SOURCE_COMMIT, cliVersion: env.CLI_VERSION, resourceVersion: env.RESOURCE_VERSION, resourceDigest: env.RESOURCE_DIGEST, descriptorSha256: env.DESCRIPTOR_SHA256, verifiedDelivery: true }) + '\n');
console.log(`Verified resource ${env.RESOURCE_VERSION} and published CLI ${env.CLI_VERSION}`);
