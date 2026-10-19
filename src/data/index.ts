import { proxyName } from "../language/naming";
import { parseIconManifest, type IconManifest } from "./manifest";
export { parseIconManifest } from "./manifest";

export type Tier = "free" | "pro";

export interface IconEntry {
  name: string;
  styleGroup: string;
  tier: Tier;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadIconManifest(value: unknown): IconManifest | undefined {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2) || !Array.isArray(value.entries)) return undefined;
  return parseIconManifest(value);
}

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "pro";
}

export function toComponentName(iconName: string): string {
  return proxyName(iconName);
}

export function loadIcons(value: unknown = []): IconEntry[] {
  const raw = value;
  const manifest = loadIconManifest(raw);
  if (manifest) return manifest.entries.map(entry => ({ name: entry.id, styleGroup: entry.styleGroup, tier: entry.minimumTier }));
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: IconEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const { name, styleGroup, tier } = item as {
      name?: unknown;
      styleGroup?: unknown;
      tier?: unknown;
    };
    if (typeof name === "string" && typeof styleGroup === "string" && isTier(tier)) {
      result.push({ name, styleGroup, tier });
    }
  }
  return result;
}

function matchesPrefix(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

export function searchIcons(prefix: string, value: unknown = []): IconEntry[] {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return loadIcons(value);
  }
  return loadIcons(value).filter(
    (entry) =>
      matchesPrefix(entry.name, trimmed) ||
      matchesPrefix(toComponentName(entry.name), trimmed),
  );
}
