import * as vscode from "vscode";
import { HIGHLIGHT_LANGUAGE_IDS } from "../constants";
import type { LanguageService } from "../language/service";

/** Complete verified in-scope exports; never insert a guessed package import. */
export function registerCompletionProviders(service: LanguageService): vscode.Disposable[] {
  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position, cancellation) {
      const analysis = await service.analyze(document);
      if (!analysis || cancellation.isCancellationRequested) return undefined;
      return analysis.completions(document.offsetAt(position)).map(candidate => {
        const item = new vscode.CompletionItem(candidate.name, candidate.symbol.kind === "factory" ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Class);
        item.insertText = candidate.name;
        item.range = new vscode.Range(document.positionAt(candidate.start), document.positionAt(candidate.end));
        item.detail = candidate.symbol.kind === "namespace" ? "Moe Icons namespace" : candidate.symbol.iconId ?? "Moe Icons API";
        return item;
      });
    },
  };
  return HIGHLIGHT_LANGUAGE_IDS.map(language => vscode.languages.registerCompletionItemProvider(language, provider, "<", "."));
}
