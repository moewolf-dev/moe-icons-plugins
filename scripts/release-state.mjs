#!/usr/bin/env node

/** Allocate and persist idempotent plugin release versions from verified events. */
import { readFile, writeFile, rename, stat, mkdir, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = resolve(root, "data/release-state.json");
const mapPath = resolve(root, "data/version-map.json");
const packagePath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");
const repos = new Set(["moewolf-dev/moe-icons-code-library", "moewolf-dev/moe-icons-cli"]);
const journalPath = resolve(root, ".release-state-transaction.json");
const lockDirectory = resolve(root, ".release-state-lock");
const writablePaths = new Set([packagePath, lockPath, mapPath, statePath]);
const phases = ["received", "validated", "versionAllocated", "packaged", "published", "verified"];

function assert(value, message) { if (!value) throw new Error(message); }
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function semver(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error("stable SemVer X.Y.Z is required");
  return value.split(".").map(Number);
}
function compare(a, b) {
  const x = semver(a), y = semver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
function sha(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function canonical(value) { return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))); }
async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
async function atomicWrite(path, content) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const mode = (await stat(path)).mode & 0o777;
  await writeFile(temp, content, { flag: "wx", mode });
  await rename(temp, path);
}

function validateEvent(event) {
  assert(record(event) && event.schemaVersion === 1, "unsupported event schema");
  const allowed = ["schemaVersion", "eventId", "sourceRepository", "sourceVersion", "sourceCommit", "cliVersion", "resourceVersion", "resourceDigest", "descriptorSha256", "verifiedDelivery"];
  assert(Object.keys(event).every(key => allowed.includes(key)), "event contains unsupported data");
  assert(typeof event.eventId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(event.eventId), "invalid eventId");
  assert(repos.has(event.sourceRepository), "untrusted source repository");
  assert(typeof event.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(event.sourceCommit), "invalid sourceCommit");
  assert(sha(event.resourceDigest), "invalid resourceDigest");
  assert(typeof event.descriptorSha256 === "string" && sha(event.descriptorSha256), "invalid descriptorSha256");
  semver(event.sourceVersion); semver(event.cliVersion); semver(event.resourceVersion);
  if (event.verifiedDelivery !== undefined) assert(event.verifiedDelivery === true && event.sourceRepository.endsWith('moe-icons-code-library'), 'joint delivery requires verified resource input');
  if (event.sourceRepository.endsWith("moe-icons-code-library")) assert(event.sourceVersion === event.resourceVersion, "resource event version mismatch");
  else assert(event.sourceVersion === event.cliVersion, "CLI event version mismatch");
}

function nextPluginVersion(currentPlugin, nextCli) {
  const [major, minor, patch] = semver(currentPlugin);
  const [cliMajor, cliMinor] = semver(nextCli);
  if (cliMajor < major || (cliMajor === major && cliMinor < minor)) throw new Error("CLI x.y cannot move plugin version backwards");
  if (cliMajor !== major || cliMinor !== minor) return `${cliMajor}.${cliMinor}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function saveRelease(event) {
  validateEvent(event);
  const [state, map, pkg, lock] = await Promise.all([readJson(statePath), readJson(mapPath), readJson(packagePath), readJson(lockPath)]);
  assert(state.schemaVersion === 1 && record(state.current) && Array.isArray(state.events), "invalid release state");
  const prior = state.events.find(item => item.eventId === event.eventId);
  if (prior) {
    assert(canonical(prior.event) === canonical(event), "eventId was reused with different payload");
    process.stdout.write(JSON.stringify({ pluginVersion: prior.pluginVersion, phase: prior.phase, duplicate: true }) + "\n");
    return;
  }
  const current = state.current;
  assert(pkg.version === current.pluginVersion, "package version does not match durable release state");
  if (event.verifiedDelivery === true) {
    assert(compare(event.cliVersion, current.cliVersion) >= 0, 'joint delivery CLI cannot move backwards');
    const resourceChange = compare(event.resourceVersion, current.resourceVersion);
    assert(resourceChange >= 0, 'resource version cannot move backwards');
    if (resourceChange === 0) {
      assert(compare(event.cliVersion, current.cliVersion) > 0, 'joint delivery must advance CLI or resource');
      const accepted = state.events.find(item => item.pluginVersion === current.pluginVersion && item.phase === 'verified');
      assert(accepted && ['resourceVersion','sourceCommit','descriptorSha256','resourceDigest'].every(key => accepted.event[key] === event[key]), 'CLI repair requires the same verified resource identity');
    }
  } else if (event.sourceRepository.endsWith("moe-icons-code-library")) {
    assert(event.cliVersion === current.cliVersion, "resource event does not reference the accepted CLI baseline");
    assert(compare(event.resourceVersion, current.resourceVersion) > 0, "resource version is old or already accepted");
  } else {
    assert(compare(event.cliVersion, current.cliVersion) > 0, "CLI version is old or already accepted");
    assert(event.resourceVersion === current.resourceVersion, "CLI release references an unaccepted resource version");
  }
  const pluginVersion = nextPluginVersion(current.pluginVersion, event.cliVersion);
  const entry = { pluginVersion, cliVersion: event.cliVersion, resourceVersion: event.resourceVersion, sourceCommit: event.sourceCommit, descriptorSha256: event.descriptorSha256, resourceDigest: event.resourceDigest, eventId: event.eventId };
  const oldHistory = Array.isArray(map) ? map.map(item => ({ pluginVersion: item.pluginVersion, resourceVersion: item.libraryVersion })) : map.history;
  assert(Array.isArray(oldHistory), "invalid version map history");
  const updatedMap = { schemaVersion: 1, history: [...oldHistory, entry] };
  const updatedState = { schemaVersion: 1, current: { pluginVersion, cliVersion: event.cliVersion, resourceVersion: event.resourceVersion }, events: [...state.events, { eventId: event.eventId, event, pluginVersion, phase: "versionAllocated" }] };
  pkg.version = pluginVersion;
  lock.version = pluginVersion;
  if (record(lock.packages) && record(lock.packages[""])) lock.packages[""].version = pluginVersion;
  const contents = [
    [packagePath, `${JSON.stringify(pkg, null, 2)}\n`],
    [lockPath, `${JSON.stringify(lock, null, 2)}\n`],
    [mapPath, `${JSON.stringify(updatedMap, null, 2)}\n`],
    [statePath, `${JSON.stringify(updatedState, null, 2)}\n`],
  ];
  await transaction(contents);
  process.stdout.write(JSON.stringify({ pluginVersion, phase: "versionAllocated", duplicate: false }) + "\n");
}

async function markPhase(eventId, phase, details = {}) {
  assert(phases.includes(phase), "invalid release phase");
  const state = await readJson(statePath);
  const item = state.events.find(entry => entry.eventId === eventId);
  assert(item, "release event is not allocated");
  const priorIndex = phases.indexOf(item.phase), nextIndex = phases.indexOf(phase);
  assert(nextIndex >= priorIndex && nextIndex <= priorIndex + 1, "release phase cannot skip or move backwards");
  for (const key of Object.keys(details)) assert(["commit", "tag", "vsixSha256", "publishedAt"].includes(key), "unsupported phase detail");
  if (details.commit !== undefined) assert(typeof details.commit === "string" && /^[a-f0-9]{40}$/.test(details.commit), "invalid release commit");
  if (details.tag !== undefined) assert(typeof details.tag === "string" && /^v\d+\.\d+\.\d+$/.test(details.tag), "invalid release tag");
  if (details.vsixSha256 !== undefined) assert(sha(details.vsixSha256), "invalid VSIX digest");
  if (details.publishedAt !== undefined) assert(typeof details.publishedAt === "string" && Number.isFinite(Date.parse(details.publishedAt)), "invalid publishedAt");
  Object.assign(item, details, { phase });
  await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  process.stdout.write(JSON.stringify({ eventId, pluginVersion: item.pluginVersion, phase }) + "\n");
}

async function recoverTransaction() {
  let journal;
  try { journal = await readJson(journalPath); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  assert(journal.schemaVersion === 1 && Array.isArray(journal.files) && journal.files.length === 4, "invalid transaction journal");
  const seen = new Set();
  for (const item of journal.files) {
    assert(typeof item.path === "string" && item.path === relative(root, resolve(root, item.path)) && writablePaths.has(resolve(root, item.path)) && !seen.has(item.path) && typeof item.content === "string" && sha(item.before), "invalid transaction file");
    seen.add(item.path);
    const current = await readFile(resolve(root, item.path), "utf8");
    const actual = createHash("sha256").update(current).digest("hex");
    assert(actual === item.before || current === item.content, "release files changed outside the transaction; recovery stopped");
  }
  for (const item of journal.files) await atomicWrite(resolve(root, item.path), item.content);
  await rm(journalPath);
}
async function transaction(contents) {
  const files = await Promise.all(contents.map(async ([path, content]) => ({ path: relative(root, path), content, before: createHash("sha256").update(await readFile(path)).digest("hex") })));
  await writeFile(journalPath, JSON.stringify({ schemaVersion: 1, files }), { flag: "wx", mode: 0o600 });
  await recoverTransaction();
}
async function acquireLock() {
  try { await mkdir(lockDirectory); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = await readJson(resolve(lockDirectory, "owner.json"));
    assert(Number.isInteger(owner.pid) && owner.pid > 0, "invalid release lock owner");
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
    assert(!alive, "another release operation is running; retry this event later");
    throw new Error("stale release lock from a stopped process; remove .release-state-lock after confirming no release operation is running, then retry to recover the journal");
  }
  await writeFile(resolve(lockDirectory, "owner.json"), JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
}

let locked = false;
const [command, input, phase, rawDetails] = process.argv.slice(2);
try {
  await acquireLock();
  locked = true;
  await recoverTransaction();
  if (command === "allocate" && input) await saveRelease(await readJson(resolve(input)));
  else if (command === "mark" && input && phase) await markPhase(input, phase, rawDetails ? JSON.parse(rawDetails) : {});
  else throw new Error("usage: node scripts/release-state.mjs allocate <verified-event.json> | mark <eventId> <phase> [details-json]");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "release state operation failed"}\n`);
  process.exitCode = 1;
} finally {
  if (locked) await rm(lockDirectory, { recursive: true });
}
