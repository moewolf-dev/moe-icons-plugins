#!/usr/bin/env node

/** Build the editor's metadata-only manifest from verified, extracted release inputs.
 * Usage: node scripts/generate-icons-data.mjs <release-root>
 * Expected: release-descriptor.json, release-input.json, free/ and pro/ package roots.
 * release-input.json is created by the artifact-verification step, never from untrusted dispatch data.
 */
import { proxyName } from "../src/language/naming.cjs";
import { createHash } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? "");
const fail = message => { throw new Error(message); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const exists = async path => { try { await stat(path); return true; } catch { return false; } };
const validId = value => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const validGroup = value => typeof value === "string" && /^moe-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const validName = value => typeof value === "string" && /^[A-Za-z_$][\w$]*$/.test(value);

async function main() {
  if (!process.argv[2]) fail("usage: node scripts/generate-icons-data.mjs <verified-release-root>");
  const descriptorPath = join(root, "release-descriptor.json");
  const descriptorBytes = await readFile(descriptorPath);
  const descriptor = JSON.parse(descriptorBytes.toString("utf8"));
  const evidence = await json(join(root, "release-input.json"));
  if (evidence.schemaVersion !== 1 || evidence.descriptorSha256 !== hash(descriptorBytes) ||
      evidence.resourceVersion !== descriptor.fullVersion || evidence.sourceCommit !== descriptor.sourceCommit ||
      !/^[a-f0-9]{40}$/.test(descriptor.sourceCommit ?? "") || !/^\d+\.\d+\.\d+$/.test(descriptor.fullVersion ?? "")) {
    fail("release input evidence does not match descriptor");
  }
  const entries = new Map();
  const documents = new Map();
  const readText = async path => { if (!documents.has(path)) documents.set(path, await readFile(path, "utf8")); return documents.get(path); };
  const readJson = async path => JSON.parse(await readText(path));
  const targetSets = ["react", "vue", "vanilla", "assets"];
  for (const tier of ["free", "pro"]) {
    const pkg = join(root, tier);
    const catalogBytes = Buffer.from(await readText(join(pkg, "catalog.json")));
    const catalog = JSON.parse(catalogBytes.toString("utf8"));
    const ref = descriptor[tier]?.metadata?.files?.["catalog.json"];
    if (!ref || hash(catalogBytes) !== ref.sha256 || catalog.sourceCommit !== descriptor.sourceCommit || catalog.sourceVersion !== descriptor.fullVersion || !Array.isArray(catalog.styleGroups) || !Array.isArray(catalog.icons)) fail(`${tier} catalog is not bound to the release descriptor`);
    for (const style of catalog.styleGroups) if (!validGroup(style.id) || !Array.isArray(style.tiers) || !Array.isArray(style.formats)) fail(`invalid ${tier} style group metadata`);
    for (const icon of catalog.icons) {
      if (!validId(icon.id) || !Array.isArray(icon.availableIn) || !Array.isArray(icon.targets) || icon.targets.some(target => !targetSets.includes(target))) fail(`invalid ${tier} icon catalog entry`);
      for (const styleGroup of icon.availableIn) {
        if (!validGroup(styleGroup) || !catalog.styleGroups.some(item => item.id === styleGroup)) fail(`unknown style group for ${icon.id}`);
        const group = catalog.styleGroups.find(item => item.id === styleGroup);
        const formats = group.formats;
        const mediaTypes = new Map([["svg", "image/svg+xml"], ["png", "image/png"], ["webp", "image/webp"], ["jpeg", "image/jpeg"], ["jpg", "image/jpeg"]]);
        if (group.type === "bitmap" || group.variants?.length) {
          for (const variant of group.variants ?? []) {
            const match = /^(.+)-(\d+)-(png|webp)$/.exec(variant);
            if (!match || match[1] !== styleGroup) fail(`invalid bitmap variant ${variant}`);
            const format = match[3], size = Number(match[2]);
            const shard = descriptor.bitmapShards?.find(item => item.tier === tier && item.styleGroupId === styleGroup && item.format === format && item.imageSize?.width === size && item.imageSize?.height === size && item.resourceVersion === descriptor.fullVersion);
            if (!shard || !/^[a-f0-9]{64}$/.test(shard.manifestSha256 ?? "")) fail(`missing verified bitmap metadata for ${variant}`);
            // Bitmap components are generated locally by the CLI. The bundled
            // manifest records only available asset variants, never guessed exports.
            entries.set(`${variant}\0${icon.id}`, { id: icon.id, styleGroup: variant, minimumTier: tier, mediaType: mediaTypes.get(format), bindings: [{ target: "assets", usageKind: "asset", assetReference: `assets/${variant}/${icon.id}.${format}` }] });
          }
          continue;
        }
        const groupMedia = [...new Set(formats.map(format => mediaTypes.get(format)).filter(Boolean))];
        if (groupMedia.length !== 1 || groupMedia.length !== formats.length) fail(`style group ${styleGroup} has ambiguous or unsupported media formats`);
        const mediaType = groupMedia[0];
        const key = `${styleGroup}\0${icon.id}`;
        const current = entries.get(key) ?? { id: icon.id, styleGroup, minimumTier: tier === "free" ? "free" : "pro", mediaType, bindings: [] };
        if (tier === "free") current.minimumTier = "free";
        if (current.mediaType !== mediaType) fail(`media type conflict for ${styleGroup}/${icon.id}`);
        for (const target of icon.targets) {
          if (target === "assets") {
            const manifest = await readJson(join(pkg, "assets", "manifest.json"));
            if (!Array.isArray(manifest.assets)) fail(`invalid Assets manifest for ${tier}`);
            const matching = manifest.assets.filter(asset => typeof asset?.path === "string" && /^[A-Za-z0-9._/-]+$/.test(asset.path) && !asset.path.split("/").some(part => part === ".." || part === ".") && asset.path.startsWith(`${styleGroup}/`) && asset.path.slice(styleGroup.length + 1).replace(/\.(svg|png|webp|jpe?g)$/i, "") === icon.id);
            if (matching.length > 1) fail(`multiple asset variants need an explicit manifest contract for ${styleGroup}/${icon.id}`);
            if (matching.length !== 1) fail(`missing Assets metadata for ${styleGroup}/${icon.id}`);
            current.bindings.push({ target: "assets", usageKind: "asset", assetReference: `assets/${matching[0].path}` });
            continue;
          }
          const barrelPath = target === "vanilla" ? join(pkg, "vanilla", styleGroup, "index.d.ts") : join(pkg, target, styleGroup, "index.d.ts");
          if (!await exists(barrelPath)) fail(`missing ${target} declarations for ${styleGroup}/${icon.id}`);
          const barrel = await readText(barrelPath);
          const stem = proxyName(icon.id);
          const exportRe = /export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
          for (const match of barrel.matchAll(exportRe)) {
            const moduleSubpath = match[2].replace(/^\.\//, "");
            if (!/^[A-Za-z0-9_./-]+$/.test(moduleSubpath) || moduleSubpath.includes("..")) fail(`unsafe module path for ${icon.id}`);
            if (moduleSubpath.replace(/\.vue$/, "") !== stem) continue;
            const exports = match[1].split(",").map(part => part.trim()).map(part => {
              const names = part.replace(/^type\s+/, "").split(/\s+as\s+/);
              return names.at(-1);
            }).filter(name => validName(name));
            const exportName = target === "vanilla" ? exports.find(name => name === `create${stem}`) : exports.find(name => name === stem) ?? exports.find(name => name[0] === name[0].toLowerCase());
            if (!exportName) continue;
            current.bindings.push(target === "vanilla"
              ? { target, usageKind: "factory", exportKind: "named", exportName, factoryName: exportName, moduleSubpath: `${target}/${styleGroup}` }
              : { target, usageKind: "component", exportKind: "named", exportName, componentName: stem, moduleSubpath: `${target}/${styleGroup}` });
          }
          if (!current.bindings.some(binding => binding.target === target)) fail(`missing ${target} binding for ${styleGroup}/${icon.id}`);
        }
        // Missing bindings indicate an unsupported target in this artifact, not permission to guess names.
        current.bindings = current.bindings.filter((binding, index, all) => all.findIndex(other => other.target === binding.target) === index);
        if (current.bindings.length) entries.set(key, current);
      }
    }
  }
  const manifest = { schemaVersion: 1, resourceVersion: descriptor.fullVersion, sourceCommit: descriptor.sourceCommit, sourceDigest: evidence.resourceDigest, entries: [...entries.values()].sort((a,b) => a.styleGroup.localeCompare(b.styleGroup, "en") || a.id.localeCompare(b.id, "en")).map(entry => ({ ...entry, bindings: entry.bindings.sort((a,b) => a.target.localeCompare(b.target, "en")) })) };
  if (!/^[a-f0-9]{64}$/.test(manifest.sourceDigest ?? "") || manifest.entries.length === 0) fail("release input is incomplete or has no supported bindings");
  // Refuse metadata fields that could leak payloads, host paths, or signed URLs.
  const output = JSON.stringify(manifest, null, 2) + "\n";
  if (/data:image|https?:\/\/|(?:^|[\s"'])\/(?:Users|home|Volumes)\//m.test(output)) fail("generated metadata contains a resource payload, URL, or absolute path");
  const destination = resolve(dirname(fileURLToPath(import.meta.url)), "../data/icons.json");
  const temp = `${destination}.${process.pid}.tmp`;
  const mode = (await stat(destination)).mode & 0o777;
  await writeFile(temp, output, { flag: "wx", mode });
  await rename(temp, destination);
  process.stdout.write(`wrote ${manifest.entries.length} metadata entries for ${manifest.resourceVersion}\n`);
}

try { await main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "manifest generation failed"}\n`); process.exitCode = 1; }
