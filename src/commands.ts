import * as vscode from "vscode";
import { loadIcons, type IconEntry } from "./data";
import { getSettings } from "./settings";
import { getVersionMap } from "./version";

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

export function registerListStyleLibrariesCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("moeicons.listStyleLibraries", async () => {
    const summaries = summarizeStyleGroups(loadIcons());
    if (summaries.length === 0) {
      void vscode.window.showInformationMessage("Moe Icons: no style libraries found.");
      return;
    }

    const items = summaries.map((summary) => ({
      label: summary.styleGroup,
      description: `${summary.tier} · ${summary.count} icons`,
      styleGroup: summary.styleGroup,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a style library to use for completion/highlighting",
    });

    if (picked !== undefined) {
      await vscode.workspace
        .getConfiguration("moeicons")
        .update("styleGroup", picked.styleGroup, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        `Moe Icons: style library set to "${picked.styleGroup}".`,
      );
    }
  });
}

export function registerShowVersionMapCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("moeicons.showVersionMap", () => {
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

export function registerCommands(): vscode.Disposable[] {
  return [registerListStyleLibrariesCommand(), registerShowVersionMapCommand()];
}

export function detectVersionLog(): string {
  return getSettings().libraryVersion;
}
