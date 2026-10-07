import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
const repo = 'moewolf-dev/moe-icons-plugins';
const tag = process.env.RELEASE_TAG;
if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('invalid release tag');
const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
const sleep = ms => new Promise(accept => setTimeout(accept, ms));
const started = Date.now();
gh(['workflow', 'run', 'release.yml', '--repo', repo, '--ref', 'main', '-f', `release_tag=${tag}`, '-f', 'publish=true']);
const deadline = started + 40 * 60 * 1000;
let publication;
while (Date.now() < deadline) {
  const runs = JSON.parse(gh(['api', `repos/${repo}/actions/workflows/release.yml/runs?per_page=50`])).workflow_runs;
  const matches = runs.filter(run => run.event === 'workflow_dispatch' && run.display_title === `Plugin publication ${tag}` && Date.parse(run.created_at) >= started - 1000);
  if (matches.length > 1) throw new Error('ambiguous publication run for release tag');
  publication = matches[0];
  if (publication) {
    console.log(`Plugin publication ${publication.id}: ${publication.status}; ${publication.html_url}`);
    if (publication.status === 'completed') {
      if (publication.conclusion !== 'success') throw new Error(`publication failed: ${publication.html_url}`);
      break;
    }
  }
  await sleep(15000);
}
if (!publication || publication.conclusion !== 'success') throw new Error('plugin publication deadline reached; retry same event');
const out = join(process.env.RUNNER_TEMP, `plugin-readback-${process.env.GITHUB_RUN_ID}`);
fs.mkdirSync(out, { recursive: true });
gh(['release', 'download', tag, '--repo', repo, '--pattern', 'vsix.sha256', '--dir', out, '--clobber']);
const sidecar = fs.readFileSync(join(out, 'vsix.sha256'), 'utf8').trim();
const match = /^([a-f0-9]{64})  (moe-icons-plugins-\d+\.\d+\.\d+\.vsix)$/.exec(sidecar);
if (!match || match[2] !== `moe-icons-plugins-${tag.slice(1)}.vsix`) throw new Error('invalid published VSIX sidecar');
const pkg = JSON.parse(fs.readFileSync('package.json'));
const url = `https://${pkg.publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/${pkg.publisher}/extension/${pkg.name}/${tag.slice(1)}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`;
let actual;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const child = spawn('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--max-time', '120', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0; const hash = createHash('sha256');
    const complete = new Promise((accept,reject) => { child.once('error',reject); child.once('exit', code => code === 0 ? accept() : reject(new Error('Marketplace package unavailable'))); });
    child.stderr.resume();
    try { await Promise.all([complete, pipeline(child.stdout, new Writable({ write(chunk, _, callback) {
      bytes += chunk.length; if (bytes > 64 * 1024 * 1024) return callback(new Error('VSIX exceeds budget')); hash.update(chunk); callback();
    } }))]); actual = hash.digest('hex'); } finally { child.kill(); }
    if (actual !== match[1]) throw new Error('Marketplace bytes differ from reviewed VSIX');
    break;
  } catch (error) { if (attempt === 19) throw error; await sleep(30000); }
}
const receipt = { schemaVersion: 1, eventId: process.env.EVENT_ID, resourceVersion: process.env.RESOURCE_VERSION, cliVersion: process.env.CLI_VERSION, descriptorSha256: process.env.DESCRIPTOR_SHA256, tag, runId: String(publication.id), vsixSha256: actual, marketplaceVerified: true };
fs.writeFileSync(join(out, 'plugin-publication-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
