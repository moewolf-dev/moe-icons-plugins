import * as vscode from "vscode";
import type { LanguageService } from "../language/service";
import { AccountService } from "./service";
import { accountGuidance } from "./guidance";
import { formatContract, projectGuidance } from "../diagnostics/project";
import { getVersionMap } from "../version";

class AccountView implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private readonly account: AccountService, private readonly pluginVersion: string, private readonly language: LanguageService) {}
  refresh(): void { this.changed.fire(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  async getChildren(): Promise<vscode.TreeItem[]> {
    const state = this.account.current;
    const guidance = accountGuidance(state, { remoteName: vscode.env.remoteName });
    const items = [new vscode.TreeItem("Account status", vscode.TreeItemCollapsibleState.None)];
    const title = guidance.code === undefined ? guidance.title : `${guidance.title} (${guidance.code})`;
    const titleItem = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
    titleItem.tooltip = `${guidance.title}\n${guidance.hint}`;
    items.push(titleItem);
    items.push(new vscode.TreeItem(guidance.hint, vscode.TreeItemCollapsibleState.None));
    for (const step of guidance.steps) items.push(new vscode.TreeItem(step, vscode.TreeItemCollapsibleState.None));
    if (guidance.remoteNote !== undefined) {
      const remote = new vscode.TreeItem(guidance.remoteNote, vscode.TreeItemCollapsibleState.None);
      remote.iconPath = new vscode.ThemeIcon("remote");
      items.push(remote);
    }
    if (state.kind === "authenticated") {
      items.push(new vscode.TreeItem(`Tier: ${state.tier}`, vscode.TreeItemCollapsibleState.None));
      items.push(new vscode.TreeItem(`Entitlement: ${state.status}${state.effectivePro ? " (active Pro)" : ""}`, vscode.TreeItemCollapsibleState.None));
    }
    const versionEntry = getVersionMap().find(item => item.pluginVersion === this.pluginVersion);
    const version = versionEntry?.resourceVersion ?? versionEntry?.libraryVersion ?? "unknown";
    items.push(new vscode.TreeItem(`Plugin: ${this.pluginVersion}`, vscode.TreeItemCollapsibleState.None));
    items.push(new vscode.TreeItem(`Bundled resource: ${version}`, vscode.TreeItemCollapsibleState.None));
    items.push(new vscode.TreeItem(`Build CLI version: ${versionEntry?.cliVersion ?? "unknown (not recorded)"}`, vscode.TreeItemCollapsibleState.None));
    const document = vscode.window.activeTextEditor?.document;
    const inspection = document ? await this.language.contract(document) : undefined;
    if (inspection) {
      items.push(new vscode.TreeItem(`Project: ${vscode.workspace.asRelativePath(inspection.root)}`, vscode.TreeItemCollapsibleState.None));
      items.push(new vscode.TreeItem(`Project contract: ${inspection.contract.status}`, vscode.TreeItemCollapsibleState.None));
      items.push(new vscode.TreeItem(`Versions: ${formatContract(inspection.contract)}`, vscode.TreeItemCollapsibleState.None));
      const project = projectGuidance(inspection.contract);
      if (project) items.push(new vscode.TreeItem(`${project.message} ${project.hint}`, vscode.TreeItemCollapsibleState.None));
    } else items.push(new vscode.TreeItem("Open a file in a CLI-managed project to view its installed resource", vscode.TreeItemCollapsibleState.None));
    return items;
  }
  dispose(): void { this.changed.dispose(); }
}

export function registerAccountView(context: vscode.ExtensionContext, account: AccountService, language: LanguageService): vscode.Disposable[] {
  const rawVersion: unknown = context.extension.packageJSON.version;
  const viewProvider = new AccountView(account, typeof rawVersion === "string" ? rawVersion : "unknown", language);
  const view = vscode.window.createTreeView("moeicons.account", { treeDataProvider: viewProvider, showCollapseAll: false });
  const changed = account.onDidChange(() => viewProvider.refresh());
  const refresh = vscode.commands.registerCommand("moeicons.refreshAccount", async () => {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Checking Moe Icons account" }, () => account.refresh(true));
  });
  const open = vscode.commands.registerCommand("moeicons.showAccount", async () => {
    await vscode.commands.executeCommand("workbench.view.explorer");
    await vscode.commands.executeCommand("moeicons.account.focus");
    await account.refresh();
  });
  const focus = vscode.window.onDidChangeWindowState(state => { if (state.focused) void account.refresh(true); });
  const poll = setInterval(() => { void account.refresh(true); }, 15_000);
  const polling = { dispose() { clearInterval(poll); } };
  void account.refresh();
  const disposables = [language.onDidChange(() => viewProvider.refresh()), vscode.window.onDidChangeActiveTextEditor(() => viewProvider.refresh()), view, viewProvider, changed, refresh, open, focus, polling];
  return disposables;
}
