import * as vscode from "vscode";
import {
  COMPLETION_LANGUAGE_IDS,
  COMPLETION_LINE_PATTERN,
} from "../constants";
import { searchIcons, toComponentName, type IconEntry } from "../data";
import { getSettings } from "../settings";
import { buildImportEdit } from "./imports";

function filterByStyleGroup(entries: IconEntry[], styleGroup: string): IconEntry[] {
  if (styleGroup === "all") {
    return entries;
  }
  return entries.filter((entry) => entry.styleGroup === styleGroup);
}

export function provideIconCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.CompletionItem[] | undefined {
  const lineText = document.lineAt(position.line).text;
  const textBeforeCursor = lineText.substring(0, position.character);
  const match = textBeforeCursor.match(COMPLETION_LINE_PATTERN);
  if (match === null || match[1] === undefined) {
    return undefined;
  }

  const prefix = match[1] ?? "";
  if (prefix.length === 0) {
    return undefined;
  }
  const prefixStart = position.character - prefix.length;
  const range = new vscode.Range(
    position.line,
    prefixStart,
    position.line,
    position.character,
  );

  const settings = getSettings();
  const candidates = filterByStyleGroup(searchIcons(prefix), settings.styleGroup);

  return candidates.map((entry) => {
    const componentName = toComponentName(entry.name);
    const item = new vscode.CompletionItem(
      componentName,
      vscode.CompletionItemKind.Interface,
    );
    item.insertText = componentName;
    item.range = range;
    item.filterText = componentName;
    item.sortText = componentName;
    item.detail = `${entry.styleGroup} · ${entry.tier}`;
    item.documentation = new vscode.MarkdownString(
      `Moe Icons \`${entry.name}\` (${entry.styleGroup}, ${entry.tier})`,
    );

    const importEdit = buildImportEdit(document, componentName);
    if (importEdit !== undefined) {
      item.additionalTextEdits = [importEdit];
    }

    return item;
  });
}

export function registerCompletionProviders(): vscode.Disposable[] {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      return provideIconCompletions(document, position);
    },
  };

  return COMPLETION_LANGUAGE_IDS.map((languageId) =>
    vscode.languages.registerCompletionItemProvider(languageId, provider, "<"),
  );
}
