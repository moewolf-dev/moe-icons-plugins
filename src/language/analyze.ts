import * as ts from "typescript";
import { baseParse, parse as parseTemplate, ElementTypes, NodeTypes, type RootNode, type TemplateChildNode } from "@vue/compiler-dom";
import type { CompletionCandidate, LanguageIssue, ModuleResolver, PublicModule, PublicSymbol, SymbolOccurrence } from "./contracts";

export interface DocumentAnalysis {
  readonly occurrences: readonly SymbolOccurrence[];
  readonly issues: readonly LanguageIssue[];
  completions(offset: number): readonly CompletionCandidate[];
}
interface Binding { symbol?: PublicSymbol; module: PublicModule; imported: string; local: string }
const empty = (): DocumentAnalysis => ({ occurrences: [], issues: [], completions: () => [] });
const kebab = (value: string): string => value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Parse only in-memory text. No module resolution, workspace execution or network. */
export function analyzeDocument(text: string, language: string, resolve: ModuleResolver): DocumentAnalysis {
  if (text.length > 500_000) return empty();
  let script = text;
  let template: { content: string; offset: number; ast: RootNode; valid: boolean } | undefined;
  let setupRange: { start: number; end: number } | undefined;
  const templateTags: { tag: string; start: number; end: number }[] = [];
  let templateBindingsAllowed = false;
  if (language === "vue") {
    // Vue SFC parser mode does not bundle optional preprocessors or evaluate scripts.
    let validSfc = true;
    const sfc = baseParse(text, { parseMode: "sfc", onError: () => { validSfc = false; } });
    const characters: string[] = text.split("").map(c => c === "\n" || c === "\r" ? c : " ");
    let templateBlock: { content: string; offset: number } | undefined;
    let normalScriptSeen = false;
    for (const node of sfc.children) {
      if (node.type !== NodeTypes.ELEMENT || !node.innerLoc) continue;
      const attr = (name: string): string | true | undefined => {
        const property = node.props.find(prop => prop.type === NodeTypes.ATTRIBUTE && prop.name === name);
        return property?.type === NodeTypes.ATTRIBUTE ? property.value?.content ?? true : undefined;
      };
      const content = text.slice(node.innerLoc.start.offset, node.innerLoc.end.offset);
      if (node.tag === "script") {
        if (attr("src") !== undefined || (attr("lang") !== undefined && !["ts", "tsx", "js", "jsx"].some(lang => lang === attr("lang")))) continue;
        if (attr("setup") !== undefined) {
          if (setupRange) return empty();
          setupRange = { start: node.innerLoc.start.offset, end: node.innerLoc.end.offset };
          templateBindingsAllowed = true;
        } else {
          if (normalScriptSeen) return empty();
          normalScriptSeen = true;
        }
        for (let i = 0; i < content.length; i++) characters[node.innerLoc.start.offset + i] = content[i];
      } else if (node.tag === "template" && attr("src") === undefined && (attr("lang") === undefined || attr("lang") === "html")) {
        if (templateBlock) return empty();
        templateBlock = { content, offset: node.innerLoc.start.offset };
      }
    }
    script = characters.join("");
    if (templateBlock) {
      let valid = validSfc;
      const ast = parseTemplate(templateBlock.content, { onError: () => { valid = false; } });
      template = { ...templateBlock, ast, valid };
    }
  }
  const source = ts.createSourceFile("document.tsx", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const host = ts.createCompilerHost({ noLib: true, noResolve: true });
  host.getSourceFile = filename => filename === source.fileName ? source : undefined;
  host.readFile = () => undefined;
  host.fileExists = filename => filename === source.fileName;
  const checker = ts.createProgram([source.fileName], { noLib: true, noResolve: true }, host).getTypeChecker();
  const bindings = new Map<ts.Symbol, Binding>();
  const exposed = new Map<string, Binding>();
  const occurrences: SymbolOccurrence[] = [];
  const issues: LanguageIssue[] = [];
  const seen = new Set<string>();
  function record(node: ts.Node, binding: Binding, symbol = binding.symbol): void {
    const start = node.getStart(source), end = node.getEnd();
    let parent: ts.Node | undefined = node;
    while (parent && !ts.isJsxOpeningElement(parent) && !ts.isJsxSelfClosingElement(parent)) parent = parent.parent;
    if (!symbol && parent && !parent.getText(source).endsWith(">")) return;
    const key = `${start}:${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (symbol && symbol.kind !== "namespace") occurrences.push({ start, end, name: node.getText(source), symbol });
    else if (!symbol && binding.module.complete) issues.push({ key: "UNKNOWN_ICON", start, end, name: node.getText(source) });
  }
  function addBinding(node: ts.Identifier, imported: string, module: PublicModule): void {
    const identity = checker.getSymbolAtLocation(node);
    if (!identity) return;
    const binding: Binding = { local: node.text, imported, module, symbol: imported === "*" ? { kind: "namespace", members: module.exports } : module.exports.get(imported) };
    bindings.set(identity, binding);
    // A normal Options API script does not expose arbitrary imports to its template.
    if (templateBindingsAllowed && language === "vue") {
      if (setupRange && node.getStart(source) >= setupRange.start && node.getEnd() <= setupRange.end) exposed.set(node.text, binding);
    }
    record(node, binding);
  }
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const module = resolve(statement.moduleSpecifier.text);
    if (!module) continue;
    if (clause.name) addBinding(clause.name, "default", module);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) addBinding(named.name, "*", module);
    else if (named) for (const element of named.elements) {
      if (!element.isTypeOnly) addBinding(element.name, element.propertyName?.text ?? element.name.text, module);
    }
  }
  function lookup(node: ts.Expression): Binding | undefined {
    if (ts.isIdentifier(node)) {
      const identity = checker.getSymbolAtLocation(node);
      return identity ? bindings.get(identity) : undefined;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const parent = lookup(node.expression);
      if (parent?.symbol?.kind !== "namespace") return undefined;
      return { ...parent, symbol: parent.symbol.members.get(node.name.text), imported: node.name.text };
    }
    return undefined;
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isJsxElement(node) && node.closingElement.getText(source).endsWith(">") && node.openingElement.tagName.getText(source) !== node.closingElement.tagName.getText(source) && lookup(node.openingElement.tagName as ts.Expression)?.symbol) {
      const tag = node.closingElement.tagName;
      issues.push({key:"MALFORMED_USAGE",start:tag.getStart(source),end:tag.getEnd(),name:tag.getText(source)});
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const binding = lookup(node.tagName as ts.Expression);
      if (binding?.symbol?.kind === "factory" || binding?.symbol?.kind === "namespace") {
        issues.push({key:"INVALID_SYMBOL_NAME",start:node.tagName.getStart(source),end:node.tagName.getEnd(),name:node.tagName.getText(source)});
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const binding = lookup(node);
      if (binding) record(node.name, binding);
      visit(node.expression);
      return;
    }
    if (ts.isIdentifier(node)) {
      // Binding identity excludes same-name parameters and lexical shadows.
      const binding = lookup(node);
      if (binding && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) record(node, binding);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  function templateBinding(tag: string): Binding | undefined {
    const parts = tag.split(".");
    const head = parts.shift();
    if (!head) return undefined;
    let binding = exposed.get(head) ?? [...exposed.values()].find(item => kebab(item.local) === tag);
    for (const part of parts) {
      if (binding?.symbol?.kind !== "namespace") return undefined;
      binding = { ...binding, imported: part, symbol: binding.symbol.members.get(part) };
    }
    return binding;
  }
  if (template) {
    const block = template;
    const walk = (node: RootNode | TemplateChildNode): void => {
      if (node.type === NodeTypes.ELEMENT) {
        // Conservatively skip scoped template subtrees rather than guessing alias bindings.
        if (node.props.some(prop => prop.type === NodeTypes.DIRECTIVE && ["for", "slot"].includes(prop.name))) return;
        const tagStart = block.offset + node.loc.start.offset + 1;
        if (node.tagType === ElementTypes.COMPONENT) templateTags.push({ tag: node.tag, start: tagStart, end: tagStart + node.tag.length });
        const binding = block.valid && node.tagType === ElementTypes.COMPONENT ? templateBinding(node.tag) : undefined;
        if (binding) {
          const start = block.offset + node.loc.start.offset + 1;
          const end = start + node.tag.length;
          if (binding.symbol && binding.symbol.kind !== "namespace") occurrences.push({ start, end, name: node.tag, symbol: binding.symbol });
          else if (!binding.symbol && binding.module.complete) issues.push({ key: "UNKNOWN_ICON", start, end, name: node.tag });
        }
      }
      if (node.type === NodeTypes.ROOT || node.type === NodeTypes.ELEMENT) for (const child of node.children) walk(child);
      else if (node.type === NodeTypes.IF) for (const branch of node.branches) for (const child of branch.children) walk(child);
      else if (node.type === NodeTypes.FOR) for (const child of node.children) walk(child);
    };
    walk(block.ast);
  }
  return {
    occurrences: occurrences.sort((a, b) => a.start - b.start), issues,
    completions(offset) {
      if (language === "vue" && templateBindingsAllowed) {
        const tag = templateTags.find(item => item.start < offset && offset <= item.end);
        if (tag) {
          const prefix = text.slice(tag.start, offset);
          const dot = prefix.lastIndexOf(".");
          const partial = prefix.slice(dot + 1);
          const binding = dot >= 0 ? templateBinding(prefix.slice(0, dot)) : undefined;
          let choices: ReadonlyMap<string, PublicSymbol> = new Map();
          if (binding?.symbol?.kind === "namespace") choices = binding.symbol.members;
          else if (dot < 0) {
            const imports = new Map<string, PublicSymbol>();
            for (const [name, value] of exposed) if (value.symbol) imports.set(name, value.symbol);
            choices = imports;
          }
          return [...choices].flatMap(([name, symbol]) => {
            const insert = dot < 0 && partial.includes("-") ? kebab(name) : name;
            return symbol.kind === "component" && insert.toLowerCase().startsWith(partial.toLowerCase()) ? [{ name: insert, symbol, start: offset - partial.length, end: offset }] : [];
          });
        }
      }
      // AST-confirmed JSX tag / property contexts only. Ordinary strings/comments never match.
      let candidateNode: ts.Node | undefined;
      const locate = (node: ts.Node): void => {
        if (node.kind === ts.SyntaxKind.EndOfFileToken || node.pos === node.end) return;
        if (node.getStart(source) <= offset && node.getEnd() >= offset) {
          candidateNode = node;
          ts.forEachChild(node, locate);
        }
      };
      locate(source);
      if (!candidateNode) return [];
      let context: ts.Node | undefined = candidateNode;
      while (context && !ts.isJsxOpeningElement(context) && !ts.isJsxSelfClosingElement(context) && !ts.isPropertyAccessExpression(context)) context = context.parent;
      if (!context) return [];
      const expression = ts.isPropertyAccessExpression(context) ? context : context.tagName;
      if (offset > expression.getEnd() || offset < expression.getStart(source)) return [];
      const prefix = script.slice(expression.getStart(source), offset);
      const match = /^(?:([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.)?([A-Za-z_$][\w$]*)$/.exec(prefix);
      if (!match) return [];
      const partial = match[2];
      const candidates: CompletionCandidate[] = [];
      const jsxContext = !ts.isPropertyAccessExpression(context) || ts.isJsxOpeningElement(context.parent) || ts.isJsxSelfClosingElement(context.parent);
      const eligible = (name: string, symbol: PublicSymbol): boolean => jsxContext ? symbol.kind === "component" || name === "MoeiconsProvider" : symbol.kind !== "namespace";
      const start = offset - partial.length;
      if (ts.isPropertyAccessExpression(expression)) {
        const parent = lookup(expression.expression);
        if (parent?.symbol?.kind === "namespace") for (const [name, symbol] of parent.symbol.members) {
          if (name.toLowerCase().startsWith(partial.toLowerCase()) && eligible(name, symbol)) candidates.push({ name, symbol, start, end: offset });
        }
      } else for (const [identity, binding] of bindings) {
        if (binding.symbol && eligible(binding.imported, binding.symbol) && binding.local.toLowerCase().startsWith(partial.toLowerCase())) {
          const visible = checker.getSymbolsInScope(expression, ts.SymbolFlags.Value | ts.SymbolFlags.Alias).find(item => item.name === binding.local);
          if (visible === identity) candidates.push({ name: binding.local, symbol: binding.symbol, start, end: offset });
        }
      }
      return candidates;
    },
  };
}
