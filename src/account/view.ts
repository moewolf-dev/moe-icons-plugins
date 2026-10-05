import * as vscode from "vscode";
import { AccountService } from "./service";
import { getErrorCode } from "../diagnostics/core";
import { getVersionMap } from "../version";

class AccountView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private readonly account: AccountService, private readonly pluginVersion: string) {}
  refresh(): void { this.changed.fire(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  async getChildren(): Promise<vscode.TreeItem[]> {
    const state = this.account.current;
    const items = [new vscode.TreeItem("Account status", vscode.TreeItemCollapsibleState.None)];
    if (state.kind === "signedOut") items.push(new vscode.TreeItem("Please sign in with the moeicons CLI", vscode.TreeItemCollapsibleState.None));
    else if (state.kind === "sessionExpired") {
      const definition = getErrorCode("ACCOUNT_SESSION_EXPIRED");
      items.push(new vscode.TreeItem(`${definition?.message ?? "Session expired."} ${definition?.hint ?? ""}`, vscode.TreeItemCollapsibleState.None));
    } else if (state.kind === "unknown") {
      const definition = getErrorCode("ACCOUNT_UNAVAILABLE");
      items.push(new vscode.TreeItem(`${definition?.message ?? "Account status unavailable."} ${definition?.hint ?? ""}`, vscode.TreeItemCollapsibleState.None));
    }
    else {
      items.push(new vscode.TreeItem(`Tier: ${state.tier}`, vscode.TreeItemCollapsibleState.None));
      items.push(new vscode.TreeItem(`Entitlement: ${state.status}${state.effectivePro ? " (active Pro)" : ""}`, vscode.TreeItemCollapsibleState.None));
    }
    const versionEntry = getVersionMap().find(item => item.pluginVersion === this.pluginVersion);
    const version = versionEntry?.resourceVersion ?? versionEntry?.libraryVersion ?? "unknown";
    items.push(new vscode.TreeItem(`Plugin: ${this.pluginVersion}`, vscode.TreeItemCollapsibleState.None));
    items.push(new vscode.TreeItem(`Bundled resource: ${version}`, vscode.TreeItemCollapsibleState.None));
    items.push(new vscode.TreeItem(`Build CLI version: ${versionEntry?.cliVersion ?? "unknown (not recorded)"}`, vscode.TreeItemCollapsibleState.None));
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      let projectVersion = "unknown";
      try {
        const uri = vscode.Uri.joinPath(folder.uri, ".moeicons", "install-metadata.json");
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength <= 64_000) {
          const metadata: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (typeof metadata === "object" && metadata !== null && typeof (metadata as Record<string, unknown>).artifactVersion === "string") projectVersion = String((metadata as Record<string, unknown>).artifactVersion);
        }
      } catch { /* no installed project metadata */ }
      const expected = vscode.workspace.getConfiguration("moeicons", folder.uri).get<string>("libraryVersion", "").trim() || "latest bundled";
      const mismatch = projectVersion !== "unknown" && expected !== "latest bundled" && projectVersion !== expected;
      const item = new vscode.TreeItem(`${folder.name} installed resource: ${projectVersion} (expected: ${expected})`, vscode.TreeItemCollapsibleState.None);
      if (mismatch) {
        item.description = "version mismatch";
        item.tooltip = "The installed resource version differs from the configured Moe Icons libraryVersion.";
        item.iconPath = new vscode.ThemeIcon("warning");
      }
      items.push(item);
    }
    return items;
  }
  dispose(): void { this.changed.dispose(); }
}

export function registerAccountView(context: vscode.ExtensionContext, account: AccountService): vscode.Disposable[] {
  const rawVersion: unknown = context.extension.packageJSON.version;
  const viewProvider = new AccountView(account, typeof rawVersion === "string" ? rawVersion : "unknown");
  const view = vscode.window.createTreeView("moeicons.account", { treeDataProvider: viewProvider, showCollapseAll: false });
  const changed = account.onDidChange(() => viewProvider.refresh());
  const refresh = vscode.commands.registerCommand("moeicons.refreshAccount", async () => {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Checking Moe Icons account" }, () => account.refresh(true));
  });
  const open = vscode.commands.registerCommand("moeicons.showAccount", async () => {
    await vscode.commands.executeCommand("workbench.view.extension.explorer");
    await vscode.commands.executeCommand("moeicons.account.focus");
    await account.refresh();
  });
  const focus = vscode.window.onDidChangeWindowState(state => { if (state.focused) void account.refresh(true); });
  const poll = setInterval(() => { void account.refresh(true); }, 15_000);
  const polling = { dispose() { clearInterval(poll); } };
  void account.refresh();
  const disposables = [view, viewProvider, changed, refresh, open, focus, polling];
  return disposables;
}
