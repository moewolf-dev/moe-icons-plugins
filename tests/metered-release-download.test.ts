import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const script = path.resolve('scripts/metered-release-download.cjs');
const repo = 'moewolf-dev/moe-icons-plugins';
const tag = 'v1.2.3';
const vsix = Buffer.from('exact vsix bytes');
const shaFile = Buffer.from(`${crypto.createHash('sha256').update(vsix).digest('hex')}  moe-icons-plugins-1.2.3.vsix\n`);

function fixture({ mismatch = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-meter-'));
  const vsixDigest = mismatch ? 'b'.repeat(64) : crypto.createHash('sha256').update(vsix).digest('hex');
  const release = {
    tag_name: tag,
    assets: [
      { id: 10, name: 'moe-icons-plugins-1.2.3.vsix', size: vsix.length, digest: `sha256:${vsixDigest}` },
      { id: 11, name: 'vsix.sha256', size: shaFile.length, digest: `sha256:${crypto.createHash('sha256').update(shaFile).digest('hex')}` },
    ],
  };
  fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify(release));
  fs.writeFileSync(path.join(dir, 'vsix'), vsix);
  fs.writeFileSync(path.join(dir, 'sha'), shaFile);
  fs.writeFileSync(path.join(dir, 'gh'), `#!${process.execPath}
const fs=require('node:fs');
const route=process.argv[3];
const dir=process.env.FIXTURE;
if(route==='repos/${repo}/releases/tags/${encodeURIComponent(tag)}'){process.stdout.write(fs.readFileSync(dir+'/release.json'));process.exit(0)}
if(route.endsWith('/releases/assets/10')){
  if(fs.existsSync(dir+'/fail-once')){fs.unlinkSync(dir+'/fail-once');process.stderr.write('HTTP 503');process.exit(1)}
  process.stdout.write(fs.readFileSync(dir+'/vsix'));process.exit(0)
}
if(route.endsWith('/releases/assets/11')){process.stdout.write(fs.readFileSync(dir+'/sha'));process.exit(0)}
process.stderr.write('HTTP 404');process.exit(1)
`, { mode: 0o700 });
  fs.chmodSync(path.join(dir, 'gh'), 0o700);
  return { dir };
}

function run(dir, extra = []) {
  const env = { ...process.env, FIXTURE: dir, PATH: `${dir}${path.delimiter}${process.env.PATH}` };
  return spawnSync(process.execPath, [script, '--repo', repo, '--tag', tag,
    '--pattern', '*.vsix', '--pattern', 'vsix.sha256',
    '--dir', path.join(dir, 'release-artifact'), '--transport-report', path.join(dir, 'transport.json'), ...extra],
  { encoding: 'utf8', env, timeout: 60_000 });
}

test('meters each release asset body and verifies the declared digest', () => {
  const { dir } = fixture();
  try {
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'release-artifact', 'moe-icons-plugins-1.2.3.vsix')), vsix);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'transport.json'), 'utf8'));
    assert.equal(report.scope, 'plugins-release-readback');
    assert.equal(report.complete, true);
    assert.deepEqual(report.bypassRisk, []);
    assert.equal(report.totals.attempts, 2);
    assert.equal(report.totals.retries, 0);
    assert.equal(report.totals.responseBytes, vsix.length + shaFile.length);
    assert.equal(report.totals.verifiedDownloads, 2);
    assert.match(result.stdout, /\[small-pack-consumer-transport\]/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a transient asset failure is retried and keeps the unknown total', () => {
  const { dir } = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'fail-once'), '1');
    const result = run(dir);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'transport.json'), 'utf8'));
    assert.equal(report.totals.attempts, 3);
    assert.equal(report.totals.retries, 1);
    assert.equal(report.totals.failedAttempts, 1);
    assert.equal(report.totals.unknownResponses, 1);
    assert.equal(report.complete, false);
    assert.ok(report.bypassRisk.includes('unknown-response-bytes'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a digest mismatch fails the download and leaves no file', () => {
  const { dir } = fixture({ mismatch: true });
  try {
    const result = run(dir);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(dir, 'release-artifact', 'moe-icons-plugins-1.2.3.vsix')), false);
    assert.match(result.stderr, /digest/);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'transport.json'), 'utf8'));
    assert.equal(report.complete, false);
    assert.equal(report.totals.failedCalls, 1);
    assert.equal(report.totals.responseBytes, 0);
    assert.ok(report.totals.deliveredBytesOnFailure > 0);
    assert.ok(report.bypassRisk.includes('failed-download-call'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
