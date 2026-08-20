import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type VersionSource = "config" | "package";

export type LibraryVersionResult =
  | { kind: "ok"; version: string; source: VersionSource }
  | { kind: "unknown" };

const CONFIG_FILENAMES = [
  "moeicons.config.ts",
  "moeicons.config.js",
  "moeicons.config.json",
] as const;

const PACKAGE_NAMES = ["moe-icons", "moeicons"] as const;

const VERSION_PATTERN = /(\d+\.\d+\.\d+)/;

function readVersionFromPackageJson(packageJsonPath: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (typeof raw !== "object" || raw === null) {
      return undefined;
    }
    const version = (raw as { version?: unknown }).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

function readVersionFromPackage(workspaceRoot: string): string | undefined {
  for (const packageName of PACKAGE_NAMES) {
    const packageJsonPath = join(
      workspaceRoot,
      "node_modules",
      packageName,
      "package.json",
    );
    if (!existsSync(packageJsonPath)) {
      continue;
    }
    const version = readVersionFromPackageJson(packageJsonPath);
    if (version !== undefined) {
      return version;
    }
  }
  return undefined;
}

function readVersionFromConfig(workspaceRoot: string): string | undefined {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = join(workspaceRoot, filename);
    if (!existsSync(configPath)) {
      continue;
    }
    try {
      const content = readFileSync(configPath, "utf8");
      const match = content.match(VERSION_PATTERN);
      if (match !== null && match[1] !== undefined) {
        return match[1];
      }
    } catch {
      // ignore unreadable config files
    }
  }
  return undefined;
}

export function detectLibraryVersion(workspaceRoot: string): LibraryVersionResult {
  const configVersion = readVersionFromConfig(workspaceRoot);
  if (configVersion !== undefined) {
    return { kind: "ok", version: configVersion, source: "config" };
  }

  const packageVersion = readVersionFromPackage(workspaceRoot);
  if (packageVersion !== undefined) {
    return { kind: "ok", version: packageVersion, source: "package" };
  }

  return { kind: "unknown" };
}
