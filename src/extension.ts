import * as vscode from "vscode";
import { registerCompletionProviders } from "./completion/provider";
import { registerHighlightProvider } from "./highlight/provider";
import { registerCommands } from "./commands";
import { LanguageService } from "./language/service";
import { registerDiagnostics } from "./diagnostics/provider";
import { AccountService } from "./account/service";
import { registerAccountView } from "./account/view";
import { createExtensionLogging } from "./logging/output";

export function activate(context: vscode.ExtensionContext): void {
  const logging = createExtensionLogging();
  context.subscriptions.push({ dispose: () => logging.dispose() });
  const rawVersion: unknown = context.extension.packageJSON.version;
  logging.logger.lifecycle("extension.activated", {
    pluginVersion: typeof rawVersion === "string" ? rawVersion : "unknown",
    hostKind: vscode.env.remoteName === undefined ? "local" : "remote",
    remote: vscode.env.remoteName,
  });

  const language = new LanguageService();
  const account = new AccountService({ log: logging.logger });
  context.subscriptions.push({ dispose: () => account.dispose() });
  context.subscriptions.push(language);
  context.subscriptions.push(...registerCompletionProviders(language));
  context.subscriptions.push(registerHighlightProvider(language));
  context.subscriptions.push(registerDiagnostics(language, account));
  context.subscriptions.push(...registerCommands(language, context.extensionUri, logging.logger));
  context.subscriptions.push(...registerAccountView(context, account, language));
}

export function deactivate(): void {
  // No-op: all disposables are registered via the extension context.
}
