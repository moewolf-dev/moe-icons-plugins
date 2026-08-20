import rawVersionMap from "../../data/version-map.json";

export interface VersionMapEntry {
  pluginVersion: string;
  libraryVersion: string;
}

export function getVersionMap(): VersionMapEntry[] {
  const raw = rawVersionMap as unknown;
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: VersionMapEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const { pluginVersion, libraryVersion } = item as {
      pluginVersion?: unknown;
      libraryVersion?: unknown;
    };
    if (typeof pluginVersion === "string" && typeof libraryVersion === "string") {
      result.push({ pluginVersion, libraryVersion });
    }
  }
  return result;
}

export function findLibraryVersion(pluginVersion: string): string | undefined {
  return getVersionMap().find((entry) => entry.pluginVersion === pluginVersion)
    ?.libraryVersion;
}
