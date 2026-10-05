import * as vscode from "vscode";
import { analyzeDocument, type DocumentAnalysis } from "./analyze";
import { readProjectSnapshot, type ProjectSnapshot } from "./project";

/** Shared project/document cache. All consumers observe the same provenance and invalidation. */
export class LanguageService implements vscode.Disposable {
  private readonly documents = new Map<string, { version: number; epoch: number; analysis: DocumentAnalysis }>();
  private readonly projects = new Map<string, Promise<ProjectSnapshot>>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private epoch = 0;
  private disposed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[];
  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx,js,jsx,vue,json,jsonc}");
    const invalidate = (): void => this.invalidate();
    this.disposables = [watcher, watcher.onDidCreate(invalidate), watcher.onDidChange(invalidate), watcher.onDidDelete(invalidate),
      vscode.workspace.onDidChangeWorkspaceFolders(invalidate), vscode.workspace.onDidChangeConfiguration(invalidate),
      vscode.workspace.onDidGrantWorkspaceTrust(invalidate),
      vscode.workspace.onDidSaveTextDocument(invalidate),
      vscode.workspace.onDidChangeTextDocument(event => {
        this.documents.delete(event.document.uri.toString());
        const file = event.document.uri.fsPath;
        // An edited generated module must not retain a verified export surface.
        void Promise.all([...this.projects.values()]).then(snapshots => {
          if (!this.disposed && snapshots.some(snapshot => snapshot.owns(file))) this.invalidate();
        });
      }),
      vscode.workspace.onDidCloseTextDocument(document => this.documents.delete(document.uri.toString()))];
  }
  private invalidate(): void {
    if (this.disposed) return;
    this.epoch++;
    this.projects.clear(); this.documents.clear();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; this.changed.fire(); }, 100);
  }
  async analyze(document: vscode.TextDocument): Promise<DocumentAnalysis | undefined> {
    const uri = document.uri.toString(), version = document.version, epoch = this.epoch, text = document.getText();
    const cached = this.documents.get(uri);
    if (cached?.version === version && cached.epoch === epoch) return cached.analysis;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    let resolver: ReturnType<ProjectSnapshot["resolver"]> = () => undefined;
    if (vscode.workspace.isTrusted && folder?.uri.scheme === "file" && document.uri.scheme === "file") {
      const root = folder.uri.fsPath;
      let pending = this.projects.get(root);
      if (!pending) { pending = readProjectSnapshot(root); this.projects.set(root, pending); }
      const snapshot = await pending;
      if (!vscode.workspace.textDocuments.some(item => item.isDirty && snapshot.owns(item.uri.fsPath))) resolver = snapshot.resolver(document.uri.fsPath);
    }
    if (this.disposed || epoch !== this.epoch || version !== document.version || document.isClosed) return undefined;
    const analysis = analyzeDocument(text, document.languageId, resolver);
    this.documents.set(uri, { version, epoch, analysis });
    return analysis;
  }
  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.disposables.forEach(disposable => disposable.dispose());
    this.changed.dispose(); this.projects.clear(); this.documents.clear();
  }
}
