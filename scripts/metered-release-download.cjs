#!/usr/bin/env node
'use strict';
// N08-05: metered replacement for `gh release download` in the Plugins readback.
//
// gh does not report response bytes, so this script resolves the exact release
// assets through the API and streams each asset body itself. Every attempt is
// recorded in the shared consumer transport report; a failed attempt keeps only
// the prefix that was actually received.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { createRecorder, summary, writeReport } = require('./small-pack-consumer-transport.cjs');

const MAX_ASSET_BYTES = 512 * 1024 ** 2;
const MAX_ASSETS = 16;
const SAFE_REPO = /^moewolf-dev\/[a-z0-9-]+$/;
const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SAFE_PATTERN = /^[A-Za-z0-9*][A-Za-z0-9*._-]{0,199}$/;

function fail(message) { throw new Error(`plugins metered release download: ${message}`); }

function parseArgs(argv) {
  const out = { patterns: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];
    if (item === '--pattern') { out.patterns.push(next); index += 1; continue; }
    if (item.startsWith('--')) { out[item.slice(2)] = next; index += 1; }
  }
  return out;
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function globMatch(name, pattern) {
  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`).test(name);
}

function ghJson(route) {
  const result = spawnSync('gh', ['api', route], { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) fail(`gh api ${route} failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`);
  try { return JSON.parse(result.stdout); } catch (error) { fail(`gh api ${route} returned invalid JSON: ${error.message}`); }
}

function httpStatus(stderr) {
  const match = /(?:HTTP\s*)?(?:^|\s)([1-5][0-9]{2})\b/.exec(String(stderr || ''));
  return match ? Number(match[1]) : null;
}

function transient(error) {
  return /HTTP\s*(?:429|5\d\d)\b|ETIMEDOUT|ECONNRESET|timed out|timeout/i.test(String(error?.stderr || error?.message || ''));
}

function declaredDigest(asset) {
  return typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest) ? asset.digest.slice(7) : null;
}

async function downloadOnce({ repository, asset, directory, recorder, callId, attempt }) {
  const file = path.join(directory, asset.name);
  const expectedBytes = Number.isSafeInteger(asset.size) ? asset.size : null;
  const expectedSha256 = declaredDigest(asset);
  const startedAt = new Date().toISOString();
  const child = spawn('gh', ['api', `repos/${repository}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { if (stderr.length < 16_384) stderr += chunk.toString(); });
  let size = 0;
  let timedOut = false;
  const hash = crypto.createHash('sha256');
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 10 * 60 * 1000);
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve()
      : reject(Object.assign(new Error(`asset download failed (exit ${code})`), { stderr }))));
  });
  try {
    await Promise.all([completed, pipeline(
      child.stdout,
      new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > MAX_ASSET_BYTES || (expectedBytes !== null && size > expectedBytes)) {
            callback(Error('release asset exceeds its declared size or the byte budget'));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }),
    )]);
    if (expectedBytes !== null && size !== expectedBytes) throw Error(`downloaded bytes ${size} differ from declared ${expectedBytes}`);
    const actualSha256 = hash.digest('hex');
    if (expectedSha256 !== null && actualSha256 !== expectedSha256) throw Error('downloaded asset digest differs from the release asset digest');
    recorder.record({
      callId, route: `releases/assets/${asset.id}`, attempt, status: 'complete',
      responseBytes: size, deliveredBytes: size, expectedBytes,
      contentSha256: actualSha256, digestVerified: expectedSha256 === null ? null : true,
      errorClass: null, httpStatus: 200, startedAt, finishedAt: new Date().toISOString(),
    });
    return { name: asset.name, size, sha256: actualSha256 };
  } catch (error) {
    // Unknown is not zero: only the prefix that was received is recorded.
    recorder.record({
      callId, route: `releases/assets/${asset.id}`, attempt, status: 'failed', responseBytes: null,
      deliveredBytes: size, expectedBytes, contentSha256: null, digestVerified: null,
      errorClass: timedOut ? 'timeout' : /digest|declared|byte budget/.test(String(error.message)) ? 'integrity'
        : transient(error) ? 'transient' : 'fatal',
      httpStatus: httpStatus(stderr), startedAt, finishedAt: new Date().toISOString(),
    });
    fs.rmSync(file, { force: true });
    throw error;
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}

async function downloadWithRetries(options) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await downloadOnce({ ...options, attempt }); } catch (error) {
      if (attempt >= 3 || !transient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, [1000, 3000][attempt - 1]));
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = args.repo;
  const tag = args.tag;
  const directory = args.dir;
  const patterns = args.patterns;
  if (!SAFE_REPO.test(repository || '')) fail('--repo must be moewolf-dev/<repository>');
  if (!SAFE_TAG.test(tag || '')) fail('--tag is invalid');
  if (typeof directory !== 'string' || directory === '') fail('--dir is required');
  if (patterns.length === 0 || patterns.length > MAX_ASSETS) fail('--pattern is required');
  for (const pattern of patterns) {
    if (!SAFE_PATTERN.test(pattern) || !/[A-Za-z0-9]/.test(pattern)) fail(`unsafe --pattern ${pattern}`);
  }
  fs.mkdirSync(directory, { recursive: true });
  const recorder = createRecorder({ scope: 'plugins-release-readback' });
  const reportPath = args['transport-report'];
  try {
    const release = ghJson(`repos/${repository}/releases/tags/${encodeURIComponent(tag)}`);
    const selected = (release.assets || []).filter((asset) => patterns.some((pattern) => globMatch(asset.name || '', pattern)));
    if (selected.length === 0) fail(`no asset in ${tag} matches the requested patterns`);
    if (selected.length > MAX_ASSETS) fail('too many assets selected');
    for (const asset of selected) {
      if (!SAFE_NAME.test(asset.name || '') || !Number.isSafeInteger(asset.id)) fail(`unsafe release asset ${asset.name}`);
      await downloadWithRetries({ repository, asset, directory, recorder, callId: `releases/assets/${asset.id}#1` });
    }
  } finally {
    const report = recorder.close();
    if (reportPath) writeReport(reportPath, report);
    process.stdout.write(`[small-pack-consumer-transport] ${JSON.stringify(summary(report, { reportPath: reportPath || null }))}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message.startsWith('plugins metered release download: ') ? error.message : `plugins metered release download: ${error.message}`}\n`);
  process.exitCode = 1;
});
