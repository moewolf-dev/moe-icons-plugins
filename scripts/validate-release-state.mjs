#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async name => JSON.parse(await readFile(resolve(root, name), "utf8"));
const [pkg, lock, state, versionMap] = await Promise.all([
  read("package.json"), read("package-lock.json"), read("data/release-state.json"), read("data/version-map.json"),
]);
const fail = message => { throw new Error(message); };
const semver = value => typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
if (pkg.name !== "moe-icons-plugins" || pkg.publisher !== "moewolf") fail("unexpected extension identity");
if (!semver(pkg.version) || lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) fail("package and lock versions do not match");
if (state.schemaVersion !== 1 || !state.current || state.current.pluginVersion !== pkg.version || !semver(state.current.cliVersion) || !semver(state.current.resourceVersion)) fail("release baseline does not match package version");
const history = Array.isArray(versionMap) ? versionMap : versionMap.schemaVersion === 1 && Array.isArray(versionMap.history) ? versionMap.history : undefined;
if (!history) fail("unsupported version map schema");
const current = history.filter(entry => entry?.pluginVersion === pkg.version).at(-1);
if (!current || (current.resourceVersion ?? current.libraryVersion) !== state.current.resourceVersion) fail("version map does not match accepted resource baseline");
if (current.cliVersion !== undefined && current.cliVersion !== state.current.cliVersion) fail("version map does not match accepted CLI baseline");
const ids = new Set();
for (const item of state.events) {
  if (typeof item.eventId !== "string" || ids.has(item.eventId)) fail("release event ledger contains duplicate/invalid ids");
  ids.add(item.eventId);
}
process.stdout.write(`release metadata coherent for ${pkg.version}\n`);
