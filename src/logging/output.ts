import * as vscode from "vscode";
import { homedir } from "node:os";
import { MoeiconsLogger } from "./logger";

export interface ExtensionLogging {
  readonly logger: MoeiconsLogger;
  show(): void;
  dispose(): void;
}

/** Create the extension-owned output channel and its redacted writer. */
export function createExtensionLogging(): ExtensionLogging {
  const channel = vscode.window.createOutputChannel("Moe Icons");
  const diagnosticEnabled = (): boolean =>
    vscode.workspace.getConfiguration("moeicons").get<boolean>("enableDiagnosticOutput", false) === true;
  const logger = new MoeiconsLogger(
    { appendLine: value => channel.appendLine(value) },
    { diagnosticEnabled, homeDir: () => homedir() },
  );
  const configuration = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration("moeicons.enableDiagnosticOutput")) {
      logger.lifecycle("diagnostic-output.changed", { enabled: diagnosticEnabled() });
    }
  });
  const command = vscode.commands.registerCommand("moeicons.showOutput", () => channel.show(true));
  return {
    logger,
    show: () => channel.show(true),
    dispose() {
      command.dispose();
      configuration.dispose();
      channel.dispose();
    },
  };
}
