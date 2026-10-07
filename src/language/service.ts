import * as vscode from "vscode";
import { dirname, resolve } from "node:path";
import type { DocumentAnalysis } from "./analyze";
import type { ProjectSnapshot } from "./project";
import { findManagedProjectRoot } from "./project-root";
const loadEngine = () => import("./engine.js");

/** Share one verified snapshot per managed project and one analysis per revision. */
export class LanguageService implements vscode.Disposable {
  private readonly documents = new Map<string, { version: number; root: string; epoch: number; analysis: DocumentAnalysis }>();
  private readonly pendingDocuments = new Map<string, Promise<DocumentAnalysis | undefined>>();
  private readonly roots = new Map<string, Promise<string | undefined>>();
  private readonly projects = new Map<string, Promise<ProjectSnapshot>>();
  private readonly epochs = new Map<string, number>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private disposed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[];
  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx,js,jsx,vue,json,jsonc}");
    const update = (uri: vscode.Uri): void => { void this.fileChanged(uri.fsPath); };
    this.disposables = [watcher, watcher.onDidCreate(update), watcher.onDidChange(update), watcher.onDidDelete(update),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
      vscode.workspace.onDidChangeConfiguration(() => this.invalidate()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.invalidate()),
      vscode.workspace.onDidSaveTextDocument(document => update(document.uri)),
      vscode.workspace.onDidChangeTextDocument(event => {
        this.documents.delete(event.document.uri.toString());
        update(event.document.uri);
      }),
      vscode.workspace.onDidCloseTextDocument(document => this.documents.delete(document.uri.toString()))];
  }
  private async fileChanged(file: string): Promise<void> {
    // A new install may create a project that was previously absent.
    if (file.replace(/\\/g, "/").endsWith("/.moeicons/install-metadata.json")) {
      this.roots.clear();
      this.scheduleRefresh();
    }
    for (const [root, pending] of this.projects) {
      const snapshot = await pending;
      if (!this.disposed && snapshot.watches(file) && this.projects.get(root) === pending) this.invalidate(root);
    }
  }
  private invalidate(root?: string): void {
    if (this.disposed) return;
    if (root) {
      this.epochs.set(root, (this.epochs.get(root) ?? 0) + 1);
      this.projects.delete(root);
      for (const [uri, entry] of this.documents) if (entry.root === root) this.documents.delete(uri);
    } else {
      this.epochs.set("", (this.epochs.get("") ?? 0) + 1);
      for (const key of this.projects.keys()) this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
      this.roots.clear(); this.projects.clear(); this.documents.clear();
    }
    this.scheduleRefresh();
  }
  private scheduleRefresh(): void {
    if (this.disposed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; this.changed.fire(); }, 100);
  }
  async project(document: vscode.TextDocument): Promise<{ root: string; snapshot: ProjectSnapshot } | undefined> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!vscode.workspace.isTrusted || folder?.uri.scheme !== "file" || document.uri.scheme !== "file") return undefined;
    const directory = dirname(document.uri.fsPath), boundary = resolve(folder.uri.fsPath);
    const key = `${boundary}\0${directory}`;
    let discovered = this.roots.get(key);
    if (!discovered) { discovered = findManagedProjectRoot(directory, boundary); this.roots.set(key, discovered); }
    const root = await discovered;
    if (!root || this.disposed) return undefined;
    let pending = this.projects.get(root);
    if (!pending) { pending = loadEngine().then(engine => engine.readProjectSnapshot(root)); this.projects.set(root, pending); }
    const epoch = this.epochs.get(root) ?? 0;
    const snapshot = await pending;
    if (this.disposed || (this.epochs.get(root) ?? 0) !== epoch || this.projects.get(root) !== pending) return undefined;
    return { root, snapshot };
  }
  async analyze(document: vscode.TextDocument): Promise<DocumentAnalysis | undefined> {
    const uri = document.uri.toString(), version = document.version;
    const project = await this.project(document);
    if (!project) return { occurrences: [], issues: [], completions: () => [] };
    const root = project.root, epoch = this.epochs.get(root) ?? 0;
    const cached = this.documents.get(uri);
    if (cached?.version === version && cached.root === root && cached.epoch === epoch) return cached.analysis;
    const key = `${uri}\0${version}\0${root}\0${epoch}`;
    const pending = this.pendingDocuments.get(key);
    if (pending) return pending;
    const work = loadEngine().then(({ analyzeDocument }) => {
      if (this.disposed || document.isClosed || document.version !== version || (this.epochs.get(root) ?? 0) !== epoch) return undefined;
      let resolver: ReturnType<ProjectSnapshot["resolver"]> = () => undefined;
      if (project && !vscode.workspace.textDocuments.some(item => item.isDirty && project.snapshot.owns(item.uri.fsPath))) resolver = project.snapshot.resolver(document.uri.fsPath);
      const analysis = analyzeDocument(document.getText(), document.languageId, resolver);
      this.documents.set(uri, { version, root, epoch, analysis });
      return analysis;
    }).finally(() => this.pendingDocuments.delete(key));
    this.pendingDocuments.set(key, work);
    return work;
  }
  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.disposables.forEach(disposable => disposable.dispose());
    this.changed.dispose(); this.projects.clear(); this.documents.clear(); this.pendingDocuments.clear(); this.roots.clear();
  }
}
