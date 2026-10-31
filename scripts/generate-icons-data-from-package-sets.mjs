#!/usr/bin/env node
import { createRequire } from "node:module";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPackageSetMetadata } from "./package-set-metadata.mjs";

const fail = message => { throw new Error(message); };

async function readBinding(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 16 * 1024) fail("package-set binding file is outside its size/type budget");
  const bytes = await readFile(path);
  if (bytes.byteLength !== stat.size) fail("package-set binding file changed while being read");
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("package-set binding file is not JSON"); }
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) fail("usage: node scripts/generate-icons-data-from-package-sets.mjs <verified-binding.json>");
  const bindings = await readBinding(resolve(inputPath));
  const { ACTIONS_OIDC_MARKER, createActionsOidcFetch } = createRequire(import.meta.url)("./actions-oidc-fetch.cjs");
  const apiBaseUrl = process.env.MOEICONS_API_BASE_URL || "https://api.moeicons.com";
  const token = process.env.PRO_PACKAGE_SET_WORKFLOW_TOKEN;
  const manifest = await fetchPackageSetMetadata({
    bindings, apiBaseUrl, proToken: token || ACTIONS_OIDC_MARKER,
    ...(token ? {} : { fetcher: createActionsOidcFetch({ apiBaseUrl }) }),
  });
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(output) > 16 * 1024 * 1024) fail("generated icon index exceeds 16 MiB");
  if (/data:image|https?:\/\/|(?:^|[\s"'])\/(?:Users|home|Volumes)\//m.test(output)) fail("generated icon index contains an image payload, URL, or absolute path");
  const destination = fileURLToPath(new URL("../data/icons.json", import.meta.url));
  const temp = `${destination}.${process.pid}.tmp`;
  await writeFile(temp, output, { flag: "wx", mode: 0o644 });
  try { await rename(temp, destination); } catch (error) { await import("node:fs/promises").then(fs => fs.rm(temp, { force: true })); throw error; }
  process.stdout.write(`wrote ${manifest.entries.length} package-set metadata entries for ${manifest.resourceVersion}\n`);
}

try { await main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "metadata generation failed"}\n`); process.exitCode = 1; }
