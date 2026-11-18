import type { LanguageTarget } from "./contracts";

/**
 * CLI-generated project contract. This module is deliberately free of VS Code
 * and filesystem access so schema decisions can be unit tested.
 */
export const SUPPORTED_METADATA_SCHEMA = 1;
export const SUPPORTED_CATALOG_SCHEMA = 1;
/**
 * Earliest CLI generation contract represented in the verified combination
 * table (`data/version-map.json`). Metadata without a recorded CLI version is
 * tolerated: older files simply cannot be classified as "too old".
 */
export const MIN_SUPPORTED_CLI_VERSION = "0.0.5";
/** CLI users need Node 24+. The VS Code Extension Host is managed by VS Code. */
export const CLI_NODE_REQUIREMENT = "24";

export type ProjectStatus =
  | "ready"
  | "cliMissing"
  | "cliVersionTooOld"
  | "notGenerated"
  | "invalidMetadata"
  | "schemaDrift"
  | "staleGenerated";

/** Every version is optional because older CLI metadata did not record it. */
export interface ProjectVersions {
  readonly metadataSchema?: number;
  readonly catalogSchema?: number;
  readonly cliVersion?: string;
  readonly installedCliVersion?: string;
  readonly artifactVersion?: string;
  readonly resourceVersion?: string;
}

export interface ProjectContract {
  readonly status: ProjectStatus;
  readonly versions: ProjectVersions;
  /** Machine-readable reason such as `catalog-hash`; never a filesystem path. */
  readonly detail?: string;
}

export interface InstallMetadata {
  readonly schemaVersion: typeof SUPPORTED_METADATA_SCHEMA;
  readonly target: LanguageTarget;
  readonly artifactVersion: string;
  readonly generatedOutputDir: string;
  readonly catalogSha256: string;
  readonly managedFiles: Readonly<Record<string, string>>;
  readonly cliVersion?: string;
}

export type MetadataParseResult =
  | { readonly ok: true; readonly metadata: InstallMetadata }
  | {
      readonly ok: false;
      readonly status: "invalidMetadata" | "schemaDrift";
      readonly detail: string;
      readonly versions: ProjectVersions;
      readonly foundSchema?: number;
      readonly supportedSchema: number;
    };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isLanguageTarget = (value: unknown): value is LanguageTarget =>
  value === "react" || value === "vue" || value === "vanilla" || value === "assets";

export const safeProjectPath = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 512 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.includes(":") &&
  value.split("/").every(part => part.length > 0 && part !== "." && part !== "..");

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
export const isSemver = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 64 && SEMVER.test(value);

/** Compare `major.minor.patch`; prerelease/build suffixes are ignored. */
export function compareSemver(left: string, right: string): number {
  const parse = (value: string): [number, number, number] => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

const rawCliVersion = (value: Record<string, unknown>): unknown => {
  if (value.cliVersion !== undefined) return value.cliVersion;
  // Some early generators nested CLI information; tolerate and display it.
  return isRecord(value.cli) ? value.cli.version : undefined;
};

/**
 * Validate install metadata explicitly instead of folding every problem into
 * "missing project". A newer schema is reported as drift, not as corruption.
 */
export function parseInstallMetadata(value: unknown): MetadataParseResult {
  if (!isRecord(value)) {
    return { ok: false, status: "invalidMetadata", detail: "metadata-not-object", versions: {}, supportedSchema: SUPPORTED_METADATA_SCHEMA };
  }
  const rawSchema = value.schemaVersion;
  if (typeof rawSchema === "number" && rawSchema !== SUPPORTED_METADATA_SCHEMA) {
    return {
      ok: false,
      status: "schemaDrift",
      detail: "metadata-schema",
      versions: { metadataSchema: rawSchema },
      foundSchema: rawSchema,
      supportedSchema: SUPPORTED_METADATA_SCHEMA,
    };
  }
  if (rawSchema !== SUPPORTED_METADATA_SCHEMA) {
    return { ok: false, status: "invalidMetadata", detail: "metadata-schema-missing", versions: {}, supportedSchema: SUPPORTED_METADATA_SCHEMA };
  }
  if (!isLanguageTarget(value.target) ||
      typeof value.artifactVersion !== "string" || value.artifactVersion.length === 0 || value.artifactVersion.length > 64 ||
      typeof value.generatedOutputDir !== "string" || !safeProjectPath(value.generatedOutputDir) ||
      typeof value.catalogSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.catalogSha256) ||
      !isRecord(value.managedFiles) ||
      !Object.values(value.managedFiles).every(item => typeof item === "string")) {
    return { ok: false, status: "invalidMetadata", detail: "metadata-fields", versions: { metadataSchema: 1 }, supportedSchema: SUPPORTED_METADATA_SCHEMA };
  }
  const rawCli = rawCliVersion(value);
  if (rawCli !== undefined && !isSemver(rawCli)) {
    return { ok: false, status: "invalidMetadata", detail: "metadata-cli-version", versions: { metadataSchema: 1 }, supportedSchema: SUPPORTED_METADATA_SCHEMA };
  }
  const cliVersion = rawCli === undefined ? undefined : rawCli;
  return {
    ok: true,
    metadata: {
      schemaVersion: SUPPORTED_METADATA_SCHEMA,
      target: value.target,
      artifactVersion: value.artifactVersion,
      generatedOutputDir: value.generatedOutputDir,
      catalogSha256: value.catalogSha256,
      managedFiles: value.managedFiles as Record<string, string>,
      ...(cliVersion !== undefined ? { cliVersion } : {}),
    },
  };
}

/** Resolve the final status when several independent signals disagree. */
export function resolveProjectStatus(options: {
  readonly mismatchedFiles: number;
  readonly hasGeneratedModules: boolean;
  readonly target: LanguageTarget;
  readonly cliVersion?: string;
}): { status: ProjectStatus; detail?: string } {
  if (options.mismatchedFiles > 0) {
    return { status: "staleGenerated", detail: `${options.mismatchedFiles}-generated-files` };
  }
  if (!options.hasGeneratedModules && options.target !== "assets") {
    return { status: "staleGenerated", detail: "no-generated-modules" };
  }
  if (options.cliVersion !== undefined && compareSemver(options.cliVersion, MIN_SUPPORTED_CLI_VERSION) < 0) {
    return { status: "cliVersionTooOld", detail: "cli-version" };
  }
  return { status: "ready" };
}

export function resourceVersionFromCatalog(catalog: Record<string, unknown>, fallback: string): string {
  if (typeof catalog.sourceVersion === "string" && catalog.sourceVersion.length > 0) return catalog.sourceVersion;
  if (typeof catalog.catalogVersion === "string" && catalog.catalogVersion.length > 0) return catalog.catalogVersion;
  return fallback;
}
