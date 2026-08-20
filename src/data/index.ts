import rawIcons from "../../data/icons.json";
import { COMPONENT_SUFFIX } from "../constants";

export type Tier = "free" | "pro";

export interface IconEntry {
  name: string;
  styleGroup: string;
  tier: Tier;
}

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "pro";
}

function toPascalCase(name: string): string {
  return name
    .split("-")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

export function toComponentName(iconName: string): string {
  return toPascalCase(iconName) + COMPONENT_SUFFIX;
}

export function loadIcons(): IconEntry[] {
  const raw = rawIcons as unknown;
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

export function searchIcons(prefix: string): IconEntry[] {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return loadIcons();
  }
  return loadIcons().filter(
    (entry) =>
      matchesPrefix(entry.name, trimmed) ||
      matchesPrefix(toComponentName(entry.name), trimmed),
  );
}
