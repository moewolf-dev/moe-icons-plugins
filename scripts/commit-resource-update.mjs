import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 60000 }).trim();
const event = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const state = JSON.parse(fs.readFileSync('data/release-state.json', 'utf8'));
const record = state.events.find(item => item.eventId === event.eventId);
if (!record || record.event.descriptorSha256 !== event.descriptorSha256 || record.event.cliVersion !== event.cliVersion) throw new Error('release ledger/event mismatch');
const tag = `v${record.pluginVersion}`;
if (state.current.pluginVersion !== record.pluginVersion) throw new Error('old event cannot replace current plugin metadata');
const tags = git('tag', '--list', tag);
if (tags) {
  const original = JSON.parse(git('show', `${tag}:data/release-state.json`)).events.find(item => item.eventId === event.eventId);
  if (!original || original.event.descriptorSha256 !== event.descriptorSha256 || original.event.cliVersion !== event.cliVersion) throw new Error('existing tag does not match release event');
  if (git('rev-parse', `${tag}:data/icons.json`) !== git('hash-object', 'data/icons.json')) throw new Error('existing tag metadata differs; refusing same-version replacement');
  git('merge-base', '--is-ancestor', `${tag}^{commit}`, 'HEAD');
} else {
  git('add', 'data/icons.json', 'data/version-map.json', 'data/release-state.json', 'package.json', 'package-lock.json');
  const changes = git('diff', '--cached', '--name-only');
  if (changes) git('commit', '-m', `chore(release): ${tag}`);
  git('tag', '-a', tag, '-m', `Moe Icons plugin ${tag}`);
}
// Retry can finish a partially successful push without allocating another version.
git('push', 'origin', 'HEAD:main');
git('push', 'origin', tag);
fs.appendFileSync(process.env.GITHUB_OUTPUT, `plugin_version=${record.pluginVersion}\nrelease_tag=${tag}\n`);
console.log(`Resource event ${event.eventId} bound to ${tag}`);
