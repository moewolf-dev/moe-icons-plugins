import * as vscode from "vscode";

export const DEFAULT_IMPORT_SOURCE = "moe-icons";

const IMPORT_LINE_PATTERN = /^import\s+[^;]*from\s+["'][^"']+["'];?/gm;

export function isComponentImported(
  document: vscode.TextDocument,
  componentName: string,
): boolean {
  const text = document.getText();
  const importBlocks = text.match(IMPORT_LINE_PATTERN) ?? [];
  const namePattern = new RegExp(`\\b${componentName}\\b`);
  return importBlocks.some((line) => namePattern.test(line));
}

export function buildImportEdit(
  document: vscode.TextDocument,
  componentName: string,
): vscode.TextEdit | undefined {
  if (isComponentImported(document, componentName)) {
    return undefined;
  }

  const text = document.getText();
  const importBlocks = text.match(IMPORT_LINE_PATTERN) ?? [];

  const insertPosition = new vscode.Position(0, 0);
  let insertText = `import { ${componentName} } from '${DEFAULT_IMPORT_SOURCE}';\n`;

  if (importBlocks.length > 0) {
    const lastImport = importBlocks[importBlocks.length - 1];
    if (lastImport !== undefined) {
      const lastImportIndex = text.lastIndexOf(lastImport);
      const lineCountBefore = text
        .substring(0, lastImportIndex)
        .split("\n").length;
      insertText = `\nimport { ${componentName} } from '${DEFAULT_IMPORT_SOURCE}';`;
      return vscode.TextEdit.insert(new vscode.Position(lineCountBefore, 0), insertText);
    }
  }

  return vscode.TextEdit.insert(insertPosition, insertText);
}
