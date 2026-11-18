import { getErrorCode, type ErrorCode } from "./core";
import type { ProjectContract, ProjectStatus } from "../language/metadata";

const KEYS: Record<Exclude<ProjectStatus, "ready">, string> = {
  cliMissing: "PROJECT_CLI_MISSING",
  notGenerated: "PROJECT_NOT_GENERATED",
  invalidMetadata: "PROJECT_METADATA_INVALID",
  schemaDrift: "PROJECT_SCHEMA_DRIFT",
  staleGenerated: "PROJECT_GENERATED_STALE",
  cliVersionTooOld: "PROJECT_CLI_TOO_OLD",
};

/**
 * Ordered, copy/paste-able recovery steps. The extension never runs these
 * commands, opens an installer, or invokes the CLI on the user's behalf.
 */
export function projectContractSteps(contract: ProjectContract): readonly string[] {
  const steps = [
    "1. Upgrade to Node.js 24 or newer and reopen the terminal.",
    "2. Reinstall or upgrade the Moeicons CLI: `npm install -D @moewolf/moe-icons-cli@latest`.",
    "3. From the project root run `npx moeicons init`, then `npx moeicons install free` (or `pro`), then `npx moeicons generate`.",
    "4. If it still fails, run `npx moeicons doctor` and follow its guidance.",
  ];
  if (contract.status === "staleGenerated" || contract.status === "invalidMetadata") {
    steps.push("Do not hand-edit generated files; regenerate them through the CLI.");
  }
  if (contract.status === "schemaDrift" || contract.status === "cliVersionTooOld") {
    steps.push("Reload the VS Code window after regenerating; the extension refreshes automatically when metadata changes, without reinstalling the plugin.");
  }
  return steps;
}

export interface ProjectGuidance {
  readonly status: Exclude<ProjectStatus, "ready">;
  readonly definition: ErrorCode;
  readonly steps: readonly string[];
  readonly message: string;
  readonly hint: string;
}

export function projectGuidance(contract: ProjectContract): ProjectGuidance | undefined {
  if (contract.status === "ready") return undefined;
  const definition = getErrorCode(KEYS[contract.status]);
  if (!definition) throw new Error(`Missing project error code for ${contract.status}`);
  const steps = projectContractSteps(contract);
  return {
    status: contract.status,
    definition,
    steps,
    message: definition.message,
    hint: `${definition.hint} ${steps.join(" ")}`,
  };
}

/** Redaction-safe summary for logs, output panels and commands. */
export function formatContract(contract: ProjectContract): string {
  const versions = contract.versions;
  const parts = [
    `status=${contract.status}`,
    `metadataSchema=${versions.metadataSchema ?? "unknown"}`,
    `catalogSchema=${versions.catalogSchema ?? "unknown"}`,
    `cli=${versions.cliVersion ?? "not-recorded"}`,
  ];
  if (versions.installedCliVersion !== undefined) parts.push(`installedCli=${versions.installedCliVersion}`);
  parts.push(`artifact=${versions.artifactVersion ?? "unknown"}`, `resource=${versions.resourceVersion ?? "unknown"}`);
  if (contract.detail !== undefined) parts.push(`detail=${contract.detail}`);
  return parts.join(" ");
}
