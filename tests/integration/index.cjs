const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
exports.run = async function() {
  const plugin = vscode.extensions.getExtension('moewolf.moe-icons-plugins');
  assert.ok(plugin);await plugin.activate();
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
  fs.writeFileSync(process.env.MOEICONS_CORE_TEST_RESULT,JSON.stringify({extensionHost:'pass',vscode:vscode.version,checks:['activation','trusted local module','coded diagnostic and exact range','namespace completion','stale diagnostic cleared after edit']},null,2));
};
