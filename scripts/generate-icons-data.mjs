#!/usr/bin/env node

/**
 * One-off developer tool to generate `data/icons.json` from the raw SVG
 * directory of the `moe-icons-code-library` repository.
 *
 * Usage:
 *   node scripts/generate-icons-data.mjs <path-to-icons-dir> <styleGroup> <tier>
 *
 * Example:
 *   node scripts/generate-icons-data.mjs ../moe-icons-code-library/icons outline free
 *
 * Output: data/icons.json  (name / styleGroup / tier only, never any SVG).
 */

import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const sourceDir = process.argv[2];
const styleGroup = process.argv[3] ?? "outline";
const tier = process.argv[4] ?? "free";

if (!sourceDir) {
  console.error("usage: node scripts/generate-icons-data.mjs <icons-dir> [styleGroup] [tier]");
  process.exit(1);
}

if (tier !== "free" && tier !== "pro") {
  console.error("tier must be 'free' or 'pro'");
  process.exit(1);
}

const names = readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
  .map((entry) => entry.name.slice(0, -".svg".length))
  .filter((name) => name.length > 0)
  .sort((a, b) => a.localeCompare(b, "en"));

const entries = names.map((name) => ({ name, styleGroup, tier }));

const outDir = join(process.cwd(), "data");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "icons.json");
writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n", "utf8");

console.log(`wrote ${entries.length} icons -> ${outPath}`);
