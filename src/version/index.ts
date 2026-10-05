import rawVersionMap from "../../data/version-map.json";

export interface VersionMapEntry {
  pluginVersion: string;
  cliVersion?: string;
  resourceVersion?: string;
  libraryVersion?: string;
  sourceCommit?: string;
  descriptorSha256?: string;
  resourceDigest?: string;
  eventId?: string;
}

export function getVersionMap(): VersionMapEntry[] {
  const raw = rawVersionMap as unknown;
  const rows: unknown[] = Array.isArray(raw) ? raw : typeof raw === "object" && raw !== null && !Array.isArray(raw) && Array.isArray((raw as Record<string, unknown>).history) ? (raw as { history: unknown[] }).history : [];
  const result: VersionMapEntry[] = [];
  for (const item of rows) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const { pluginVersion, cliVersion, resourceVersion, libraryVersion, sourceCommit, descriptorSha256, resourceDigest, eventId } = item as {
      pluginVersion?: unknown;
      cliVersion?: unknown;
      resourceVersion?: unknown;
      libraryVersion?: unknown;
      sourceCommit?: unknown;
      descriptorSha256?: unknown;
      resourceDigest?: unknown;
      eventId?: unknown;
    };
    if (typeof pluginVersion === "string") {
      result.push({ pluginVersion,
        ...(typeof cliVersion === "string" ? { cliVersion } : {}),
        ...(typeof resourceVersion === "string" ? { resourceVersion } : {}),
        ...(typeof libraryVersion === "string" ? { libraryVersion } : {}),
        ...(typeof sourceCommit === "string" ? { sourceCommit } : {}),
        ...(typeof descriptorSha256 === "string" ? { descriptorSha256 } : {}),
        ...(typeof resourceDigest === "string" ? { resourceDigest } : {}),
        ...(typeof eventId === "string" ? { eventId } : {}),
      });
    }
  }
  return result;
}

export function findLibraryVersion(pluginVersion: string): string | undefined {
  const entry = getVersionMap().find((item) => item.pluginVersion === pluginVersion);
  return entry?.resourceVersion ?? entry?.libraryVersion;
}
