import * as vscode from "vscode";
import type { LanguageService } from "./language/service";
import { loadIcons, type IconEntry } from "./data";
import { getSettings } from "./settings";
import { getVersionMap } from "./version";
import { formatContract, projectGuidance } from "./diagnostics/project";
import type { MoeiconsLogger } from "./logging/logger";

interface StyleGroupSummary {
  styleGroup: string;
  tier: string;
  count: number;
}

function summarizeStyleGroups(entries: IconEntry[]): StyleGroupSummary[] {
  const map = new Map<string, StyleGroupSummary>();
  for (const entry of entries) {
    const key = `${entry.styleGroup}\u0000${entry.tier}`;
    const existing = map.get(key);
    if (existing !== undefined) {
      existing.count += 1;
    } else {
      map.set(key, { styleGroup: entry.styleGroup, tier: entry.tier, count: 1 });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    `${a.styleGroup}\u0000${a.tier}`.localeCompare(`${b.styleGroup}\u0000${b.tier}`),
  );
}

export function registerListStyleLibrariesCommand(service: LanguageService, extensionUri: vscode.Uri): vscode.Disposable {
  return vscode.commands.registerCommand("moeicons.listStyleLibraries", async () => {
    const document = vscode.window.activeTextEditor?.document;
    const project = document ? await service.project(document) : undefined;
    if (project) {
      void vscode.window.showInformationMessage(`Moe Icons: installed resource ${project.snapshot.version ?? "unknown"}; target ${project.snapshot.target ?? "unknown"}; styles: ${project.snapshot.styleGroups?.join(", ") || "none"}`);
      return;
    }
    // Keep the bundled catalog out of the extension-host startup path. It is
    // only needed for this explicit reference command; project-aware features
    // use the verified CLI installation already present in the workspace.
    let bundledCatalog: unknown;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, "data", "icons.json"));
      bundledCatalog = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      void vscode.window.showWarningMessage("Moe Icons: bundled style library metadata could not be read.");
      return;
    }
    const summaries = summarizeStyleGroups(loadIcons(bundledCatalog));
    if (summaries.length === 0) {
      void vscode.window.showInformationMessage("Moe Icons: no style libraries found.");
      return;
    }

    const items = summaries.map((summary) => ({
      label: summary.styleGroup,
      description: `${summary.tier} · ${summary.count} icons`,
      styleGroup: summary.styleGroup,
    }));

    await vscode.window.showQuickPick(items, {
      placeHolder: "Bundled reference only. Completion follows verified project imports; install icons with the CLI.",
    });
  });
}

export function registerShowVersionMapCommand(service: LanguageService): vscode.Disposable {
  return vscode.commands.registerCommand("moeicons.showVersionMap", async () => {
    const document = vscode.window.activeTextEditor?.document;
    const project = document ? await service.project(document) : undefined;
    if (project) {
      void vscode.window.showInformationMessage(`Moe Icons: installed resource ${project.snapshot.version ?? "unknown"} (${project.snapshot.target ?? "unknown"}). ${formatContract(project.snapshot.contract)}`);
      return;
    }
    const map = getVersionMap();
    if (map.length === 0) {
      void vscode.window.showInformationMessage("Moe Icons: version map is empty.");
      return;
    }
    const lines = map.map(entry => `plugin ${entry.pluginVersion}  ->  CLI ${entry.cliVersion ?? "unknown"}  /  resource ${entry.resourceVersion ?? entry.libraryVersion ?? "unknown"}`);
    void vscode.window.showInformationMessage(
      `Moe Icons version map:\n${lines.join("\n")}`,
      { modal: false },
    );
  });
}

export function registerShowProjectStatusCommand(service: LanguageService, logger?: Pick<MoeiconsLogger, "lifecycle" | "diagnostic">): vscode.Disposable {
  return vscode.commands.registerCommand("moeicons.showProjectStatus", async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      void vscode.window.showInformationMessage("Moe Icons: open a file in a CLI-managed project to inspect its status.");
      return;
    }
    const inspection = await service.contract(document);
    if (!inspection) {
      void vscode.window.showInformationMessage("Moe Icons: project status is unavailable in an untrusted or non-file workspace.");
      return;
    }
    const summary = formatContract(inspection.contract);
    logger?.lifecycle("project.contract", { contractStatus: inspection.contract.status, detail: inspection.contract.detail });
    const guidance = projectGuidance(inspection.contract);
    if (!guidance) {
      void vscode.window.showInformationMessage(`Moe Icons project: ${summary}`);
      return;
    }
    logger?.diagnostic("project.contract.guidance", { contractStatus: guidance.status, code: guidance.definition.code });
    const choice = await vscode.window.showWarningMessage(`Moe Icons project: ${summary}\n${guidance.message} ${guidance.hint}`, "Open troubleshooting");
    if (choice === "Open troubleshooting") void vscode.env.openExternal(vscode.Uri.parse(guidance.definition.helpUrl));
  });
}

export function registerCommands(service: LanguageService, extensionUri: vscode.Uri, logger?: Pick<MoeiconsLogger, "lifecycle" | "diagnostic">): vscode.Disposable[] {
  return [registerListStyleLibrariesCommand(service, extensionUri), registerShowVersionMapCommand(service), registerShowProjectStatusCommand(service, logger)];
}

export function detectVersionLog(): string {
  return getSettings().libraryVersion;
}
