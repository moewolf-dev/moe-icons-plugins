import * as vscode from "vscode";
import { HIGHLIGHT_LANGUAGE_IDS } from "../constants";
import type { LanguageService } from "../language/service";
import { formatIssue } from "./core";

export function registerDiagnostics(service: LanguageService): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection("moeicons");
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  function schedule(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    const old = timers.get(uri);
    if (old) clearTimeout(old);
    if (!HIGHLIGHT_LANGUAGE_IDS.some(language => language === document.languageId)) return;
    // Clear stale diagnostics immediately, including after a project invalidation.
    collection.delete(document.uri);
    timers.set(uri, setTimeout(() => {
      timers.delete(uri);
      const version = document.version;
      void service.analyze(document).then(analysis => {
        if (!analysis || disposed || document.isClosed || document.version !== version || timers.has(uri)) return;
        const diagnostics = analysis.issues.map(issue => {
          const { definition, message } = formatIssue(issue);
          const severity = definition.severity === "error" ? vscode.DiagnosticSeverity.Error : definition.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
          const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(issue.start), document.positionAt(issue.end)), message, severity);
          diagnostic.source = "moeicons";
          diagnostic.code = { value: definition.code, target: vscode.Uri.parse(definition.helpUrl) };
          return diagnostic;
        });
        collection.set(document.uri, diagnostics);
      });
    }, 300));
  }
  const listeners = [
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument(event => schedule(event.document)),
    vscode.workspace.onDidSaveTextDocument(schedule),
    service.onDidChange(() => vscode.workspace.textDocuments.forEach(schedule)),
    vscode.workspace.onDidCloseTextDocument(document => {
      const key = document.uri.toString(), timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key); collection.delete(document.uri);
    }),
  ];
  vscode.workspace.textDocuments.forEach(schedule);
  return { dispose() {
    disposed = true; timers.forEach(timer => clearTimeout(timer)); timers.clear();
    listeners.forEach(listener => listener.dispose()); collection.dispose();
  } };
}
