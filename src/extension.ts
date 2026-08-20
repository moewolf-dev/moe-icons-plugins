import * as vscode from "vscode";
import { registerCompletionProviders } from "./completion/provider";
import { registerHighlightProvider } from "./highlight/provider";
import { registerCommands } from "./commands";

export function activate(context: vscode.ExtensionContext): void {
  console.log("moe-icons-plugins: activated");

  context.subscriptions.push(...registerCompletionProviders());
  context.subscriptions.push(registerHighlightProvider());
  context.subscriptions.push(...registerCommands());
}

export function deactivate(): void {
  // No-op: all disposables are registered via the extension context.
}
