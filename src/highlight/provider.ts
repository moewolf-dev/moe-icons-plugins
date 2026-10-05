import * as vscode from "vscode";
import { HIGHLIGHT_LANGUAGE_IDS } from "../constants";
import { getSettings } from "../settings";
import type { LanguageService } from "../language/service";

const legend = new vscode.SemanticTokensLegend(["moeiconsIcon", "moeiconsKeyword"], ["light", "dark"]);
export function registerHighlightProvider(service: LanguageService): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();
  const projectChanged = service.onDidChange(() => changed.fire());
  const themeChanged = vscode.window.onDidChangeActiveColorTheme(() => changed.fire());
  const provider: vscode.DocumentSemanticTokensProvider = {
    onDidChangeSemanticTokens: changed.event,
    async provideDocumentSemanticTokens(document, cancellation) {
      const analysis = await service.analyze(document);
      if (!analysis || cancellation.isCancellationRequested) return undefined;
      const builder = new vscode.SemanticTokensBuilder(legend);
      const mode = getSettings().highlightColorMode;
      const dark = mode === "dark" || (mode === "auto" && (vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast));
      const modifier = dark ? 2 : 1;
      for (const occurrence of analysis.occurrences) {
        const start = document.positionAt(occurrence.start), end = document.positionAt(occurrence.end);
        if (start.line !== end.line) continue;
        const type = occurrence.symbol.kind === "keyword" ? 1 : 0;
        builder.push(start.line, start.character, end.character - start.character, type, type === 0 ? modifier : 0);
      }
      return builder.build();
    },
  };
  const registration = vscode.languages.registerDocumentSemanticTokensProvider(HIGHLIGHT_LANGUAGE_IDS.map(language => ({ language })), provider, legend);
  return { dispose() { registration.dispose(); projectChanged.dispose(); themeChanged.dispose(); changed.dispose(); } };
}
