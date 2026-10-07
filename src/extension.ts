import * as vscode from "vscode";
import { registerCompletionProviders } from "./completion/provider";
import { registerHighlightProvider } from "./highlight/provider";
import { registerCommands } from "./commands";
import { LanguageService } from "./language/service";
import { registerDiagnostics } from "./diagnostics/provider";
import { AccountService } from "./account/service";
import { registerAccountView } from "./account/view";

export function activate(context: vscode.ExtensionContext): void {
  console.log("moe-icons-plugins: activated");

  const language = new LanguageService();
  const account = new AccountService();
  context.subscriptions.push({ dispose: () => account.dispose() });
  context.subscriptions.push(language);
  context.subscriptions.push(...registerCompletionProviders(language));
  context.subscriptions.push(registerHighlightProvider(language));
  context.subscriptions.push(registerDiagnostics(language));
  context.subscriptions.push(...registerCommands(language));
  context.subscriptions.push(...registerAccountView(context, account));
}

export function deactivate(): void {
  // No-op: all disposables are registered via the extension context.
}
