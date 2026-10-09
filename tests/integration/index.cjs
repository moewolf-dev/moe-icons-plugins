const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
exports.run = async function() {
  const plugin = vscode.extensions.getExtension('moewolf.moe-icons-plugins');
  assert.ok(plugin);await plugin.activate();
  await vscode.commands.executeCommand('moeicons.showAccount');
  assert.ok(vscode.workspace.isTrusted);
  const root = vscode.workspace.workspaceFolders[0].uri;
  const uri = vscode.Uri.joinPath(root,'src/App.tsx');
  const document = await vscode.workspace.openTextDocument(uri);await vscode.window.showTextDocument(document);
  let diagnostics;
  for(let i=0;i<100;i++){ diagnostics=vscode.languages.getDiagnostics(uri).filter(item=>item.source==='moeicons');if(diagnostics.length)break;await sleep(100);}
  assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].code.value,'MOE-ICON-0001');
  assert.equal(document.getText(diagnostics[0].range),'Missing');
  const offset=document.getText().indexOf('Icons.Ui')+'Icons.Ui'.length;
  const completions=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',uri,document.positionAt(offset));
  assert.ok(completions.items.some(item=>typeof item.label==='string'?item.label==='UiSearch':item.label.label==='UiSearch'));
  const edit = new vscode.WorkspaceEdit();edit.replace(uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),`import * as Icons from './moeicons'; const node = <Icons.UiSearch />;`);
  await vscode.workspace.applyEdit(edit);await sleep(600);
  assert.equal(vscode.languages.getDiagnostics(uri).filter(item=>item.source==='moeicons').length,0);
  // Install a nested project after its document was already analyzed against
  // the parent project. The metadata watcher must refresh without a text edit.
  const path = require('node:path');
  const crypto = require('node:crypto');
  const nested = path.join(root.fsPath, 'apps/child');
  fs.mkdirSync(path.join(nested, 'src'), { recursive: true });
  const nestedUri = vscode.Uri.file(path.join(nested, 'src/App.tsx'));
  fs.writeFileSync(nestedUri.fsPath, "import { Missing } from './moeicons';");
  const nestedDocument = await vscode.workspace.openTextDocument(nestedUri);
  await vscode.window.showTextDocument(nestedDocument); await sleep(300);
  fs.mkdirSync(path.join(nested, '.moeicons'), { recursive: true });
  fs.mkdirSync(path.join(nested, 'src/moeicons'), { recursive: true });
  const catalog = JSON.stringify({ schemaVersion: 1, icons: [{ id: 'ui-search' }] });
  const index = 'export const UiSearch = () => null;';
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(path.join(nested, '.moeicons/catalog.json'), catalog);
  fs.writeFileSync(path.join(nested, 'src/moeicons/index.ts'), index);
  fs.writeFileSync(path.join(nested, '.moeicons/install-metadata.json'), JSON.stringify({schemaVersion:1,artifactVersion:'0.0.18',target:'react',generatedOutputDir:'src/moeicons',catalogSha256:hash(catalog),managedFiles:{'.moeicons/catalog.json':hash(catalog),'src/moeicons/index.ts':hash(index)}}));
  let nestedDiagnostics=[];
  for(let i=0;i<100;i++){nestedDiagnostics=vscode.languages.getDiagnostics(nestedUri).filter(item=>item.source==='moeicons');if(nestedDiagnostics.length)break;await sleep(100);}
  assert.equal(nestedDiagnostics.length,1,'new nested install must refresh an already open document');
  fs.writeFileSync(process.env.MOEICONS_CORE_TEST_RESULT,JSON.stringify({extensionHost:'pass',vscode:vscode.version,checks:['activation', 'account panel command','trusted local module','coded diagnostic and exact range','namespace completion','stale diagnostic cleared after edit','new nested install refreshes without editing']},null,2));
};
