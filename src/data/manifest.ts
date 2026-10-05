export type ManifestTier = "free" | "pro";
export type ManifestTarget = "react" | "vue" | "vanilla" | "assets";
export type ManifestMediaType = "image/svg+xml" | "image/png" | "image/webp" | "image/jpeg";

interface ModuleBinding {
  readonly target: "react" | "vue";
  readonly usageKind: "component";
  readonly exportKind: "named" | "default";
  readonly exportName: string;
  readonly componentName: string;
  readonly moduleSubpath: string;
}
interface FactoryBinding {
  readonly target: "vanilla";
  readonly usageKind: "factory";
  readonly exportKind: "named" | "default";
  readonly exportName: string;
  readonly factoryName: string;
  readonly moduleSubpath: string;
}
interface AssetBinding {
  readonly target: "assets";
  readonly usageKind: "asset";
  readonly assetReference: string;
}
export type IconBinding = ModuleBinding | FactoryBinding | AssetBinding;

export interface IconManifestEntry {
  readonly id: string;
  readonly styleGroup: string;
  readonly minimumTier: ManifestTier;
  readonly mediaType: ManifestMediaType;
  readonly bindings: readonly IconBinding[];
}
export interface IconManifest {
  readonly schemaVersion: 1;
  readonly resourceVersion: string;
  readonly sourceCommit: string;
  readonly sourceDigest: string;
  readonly entries: readonly IconManifestEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const safeRelative = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9._/-]+$/.test(value) && !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part.length > 0 && part !== "." && part !== "..");
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GROUP = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z_$][\w$]*$/;
const MEDIA = new Set<ManifestMediaType>(["image/svg+xml", "image/png", "image/webp", "image/jpeg"]);

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label} contains an unknown field`);
}

function parseBinding(value: unknown): IconBinding {
  if (!isRecord(value) || (value.target !== "react" && value.target !== "vue" && value.target !== "vanilla" && value.target !== "assets")) throw new Error("invalid icon binding");
  if (value.target === "assets") {
    requireOnlyKeys(value, ["target", "usageKind", "assetReference"], "asset binding");
    if (value.usageKind !== "asset" || !safeRelative(value.assetReference)) throw new Error("invalid asset binding");
    return { target: "assets", usageKind: "asset", assetReference: value.assetReference };
  }
  if (value.target === "vanilla") {
    requireOnlyKeys(value, ["target", "usageKind", "exportKind", "exportName", "factoryName", "moduleSubpath"], "factory binding");
    if (value.usageKind !== "factory" || (value.exportKind !== "named" && value.exportKind !== "default") || typeof value.exportName !== "string" || !NAME.test(value.exportName) || typeof value.factoryName !== "string" || !NAME.test(value.factoryName) || !safeRelative(value.moduleSubpath)) throw new Error("invalid factory binding");
    return { target: "vanilla", usageKind: "factory", exportKind: value.exportKind, exportName: value.exportName, factoryName: value.factoryName, moduleSubpath: value.moduleSubpath };
  }
  requireOnlyKeys(value, ["target", "usageKind", "exportKind", "exportName", "componentName", "moduleSubpath"], "component binding");
  if (value.usageKind !== "component" || (value.exportKind !== "named" && value.exportKind !== "default") || typeof value.exportName !== "string" || !NAME.test(value.exportName) || typeof value.componentName !== "string" || !NAME.test(value.componentName) || !safeRelative(value.moduleSubpath)) throw new Error("invalid component binding");
  return { target: value.target, usageKind: "component", exportKind: value.exportKind, exportName: value.exportName, componentName: value.componentName, moduleSubpath: value.moduleSubpath };
}

export function parseIconManifest(value: unknown): IconManifest {
  if (!isRecord(value)) throw new Error("icon manifest must be an object");
  requireOnlyKeys(value, ["schemaVersion", "resourceVersion", "sourceCommit", "sourceDigest", "entries"], "icon manifest");
  if (value.schemaVersion !== 1 || typeof value.resourceVersion !== "string" || !SEMVER.test(value.resourceVersion) || typeof value.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || typeof value.sourceDigest !== "string" || !SHA.test(value.sourceDigest) || !Array.isArray(value.entries)) throw new Error("invalid icon manifest header");
  const keys = new Set<string>();
  const entries: IconManifestEntry[] = value.entries.map((raw): IconManifestEntry => {
    if (!isRecord(raw)) throw new Error("invalid icon entry");
    requireOnlyKeys(raw, ["id", "styleGroup", "minimumTier", "mediaType", "bindings"], "icon entry");
    if (typeof raw.id !== "string" || !ID.test(raw.id) || typeof raw.styleGroup !== "string" || !GROUP.test(raw.styleGroup) || (raw.minimumTier !== "free" && raw.minimumTier !== "pro") || typeof raw.mediaType !== "string" || !MEDIA.has(raw.mediaType as ManifestMediaType) || !Array.isArray(raw.bindings) || raw.bindings.length === 0) throw new Error("invalid icon entry fields");
    const bindings = raw.bindings.map(parseBinding);
    const targets = new Set<ManifestTarget>();
    for (const binding of bindings) {
      if (targets.has(binding.target)) throw new Error("duplicate target binding for icon");
      targets.add(binding.target);
    }
    const key = `${raw.styleGroup}\0${raw.id}`;
    if (keys.has(key)) throw new Error("duplicate styleGroup/id entry");
    keys.add(key);
    return { id: raw.id, styleGroup: raw.styleGroup, minimumTier: raw.minimumTier, mediaType: raw.mediaType as ManifestMediaType, bindings };
  });
  return { schemaVersion: 1, resourceVersion: value.resourceVersion, sourceCommit: value.sourceCommit, sourceDigest: value.sourceDigest, entries };
}
