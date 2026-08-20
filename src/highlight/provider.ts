import * as vscode from "vscode";
import { HIGHLIGHT_LANGUAGE_IDS, IDENTIFIER_PATTERN, KEYWORD_IDENTIFIERS } from "../constants";
import { loadIcons, toComponentName } from "../data";
import { getSettings } from "../settings";

const TOKEN_TYPES = ["moeicons.icon", "moeicons.keyword"];
const TOKEN_MODIFIERS = ["light", "dark"];

const legend = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

interface MatchedToken {
  start: number;
  length: number;
  typeIndex: number;
  modifierMask: number;
}

function collectTokens(line: string, knownIcons: ReadonlySet<string>, modeIndex: number): MatchedToken[] {
  const tokens: MatchedToken[] = [];
  IDENTIFIER_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = IDENTIFIER_PATTERN.exec(line)) !== null) {
    const identifier = match[0];
    const start = match.index;
    const length = identifier.length;
    if (knownIcons.has(identifier)) {
      tokens.push({ start, length, typeIndex: 0, modifierMask: 1 << modeIndex });
    } else if (KEYWORD_IDENTIFIERS.includes(identifier as (typeof KEYWORD_IDENTIFIERS)[number])) {
      tokens.push({ start, length, typeIndex: 1, modifierMask: 0 });
    }
  }
  return tokens;
}

function buildIconSet(): ReadonlySet<string> {
  const set = new Set<string>();
  for (const entry of loadIcons()) {
    set.add(toComponentName(entry.name));
  }
  return set;
}

export function registerHighlightProvider(): vscode.Disposable {
  const knownIcons = buildIconSet();

  const provider: vscode.DocumentSemanticTokensProvider = {
    provideDocumentSemanticTokens(document) {
      const modeIndex = getSettings().highlightColorMode === "dark" ? 1 : 0;
      const builder = new vscode.SemanticTokensBuilder(legend);

      for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex).text;
        const tokens = collectTokens(line, knownIcons, modeIndex);
        for (const token of tokens) {
          builder.push(lineIndex, token.start, token.length, token.typeIndex, token.modifierMask);
        }
      }

      return builder.build();
    },
  };

  const selector: vscode.DocumentSelector = HIGHLIGHT_LANGUAGE_IDS.map((language) => ({
    language,
  }));

  return vscode.languages.registerDocumentSemanticTokensProvider(selector, provider, legend);
}
