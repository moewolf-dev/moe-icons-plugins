import * as vscode from "vscode";

export type HighlightColorMode = "light" | "dark" | "auto";

export interface MoeiconsSettings {
  highlightColorMode: HighlightColorMode;
  styleGroup: string;
  libraryVersion: string;
  websiteUrl: string;
  repositoryUrl: string;
  pluginRepositoryUrl: string;
  documentationUrl: string;
}

function readString(section: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = section.get<string>(key);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function getSettings(): MoeiconsSettings {
  const section = vscode.workspace.getConfiguration("moeicons");

  const configured = section.get<string>("highlightColorMode");
  const highlightColorMode: HighlightColorMode = configured === "dark" || configured === "light" ? configured : "auto";

  return {
    highlightColorMode,
    styleGroup: readString(section, "styleGroup", "outline"),
    libraryVersion: readString(section, "libraryVersion", ""),
    websiteUrl: readString(section, "websiteUrl", "https://moeicons.com"),
    repositoryUrl: readString(
      section,
      "repositoryUrl",
      "https://github.com/moewolf-dev/moe-icons",
    ),
    pluginRepositoryUrl: readString(
      section,
      "pluginRepositoryUrl",
      "https://github.com/moewolf-dev/moe-icons-plugins",
    ),
    documentationUrl: readString(
      section,
      "documentationUrl",
      "https://github.com/moewolf-dev/moe-icons#readme",
    ),
  };
}
