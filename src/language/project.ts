import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import type { LanguageTarget, ModuleResolver, PublicModule, PublicSymbol } from "./contracts";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const safePath = (value: string): boolean => !isAbsolute(value) && !value.includes("\\") && !value.includes(":") && value.split("/").every(part => part.length > 0 && part !== "." && part !== "..");
const inside = (root: string, file: string): boolean => {
  const rel = relative(root, file);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const target = (value: unknown): value is LanguageTarget => ["react", "vue", "vanilla", "assets"].some(item => item === value);
const keywordNames = new Set(["MoeiconsProvider", "useMoeiconsTheme", "createMoeiconsRuntime", "MOEICONS_THEME_KEY"]);
import { proxyName } from "./naming";
export { proxyName } from "./naming";
export interface ProjectSnapshot {
  readonly version?: string;
  readonly target?: LanguageTarget;
  readonly modules: ReadonlyMap<string, PublicModule>;
  owns(documentPath: string): boolean;
  resolver(documentPath: string): ModuleResolver;
}
const missing = (): ProjectSnapshot => ({ modules: new Map(), owns: () => false, resolver: () => () => undefined });

/** Only hashed CLI-managed modules are authoritative. Never execute project config. */
export async function readProjectSnapshot(workspaceRoot: string): Promise<ProjectSnapshot> {
  try {
    const root = await realpath(workspaceRoot);
    async function readWithin(path: string): Promise<string> {
      const file = await realpath(path);
      if (!inside(root, file) || (await stat(file)).size > 2_000_000) throw new Error("Untrusted project input");
      return readFile(file, "utf8");
    }
    const metadata: unknown = JSON.parse(await readWithin(resolve(root, ".moeicons/install-metadata.json")));
    if (!record(metadata) || metadata.schemaVersion !== 1 || !target(metadata.target) || typeof metadata.artifactVersion !== "string" || !record(metadata.managedFiles)) return missing();
    const outputDir = metadata.generatedOutputDir;
    if (typeof outputDir !== "string" || !safePath(outputDir)) return missing();
    const managed = metadata.managedFiles;
    const catalogText = await readWithin(resolve(root, ".moeicons/catalog.json"));
    if (digest(catalogText) !== metadata.catalogSha256 || metadata.catalogSha256 !== managed[".moeicons/catalog.json"]) return missing();
    const catalog: unknown = JSON.parse(catalogText);
    if (!record(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.icons)) return missing();
    const ids = new Map<string, string>();
    for (const icon of catalog.icons) if (record(icon) && typeof icon.id === "string") {
      const name = proxyName(icon.id);
      // Ambiguous names must not produce a false icon identity.
      if (ids.has(name) && ids.get(name) !== icon.id) return missing();
      ids.set(name, icon.id);
    }
    const files = new Map<string, string>();
    const candidates = Object.entries(managed).filter(([path, hash]) => path.startsWith(`${outputDir}/`) && safePath(path) && /\.(?:ts|tsx|js|jsx|vue)$/.test(path) && typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));
    if (candidates.length > 3000) return missing();
    let totalBytes = 0;
    for (const [path, hash] of candidates) {
      const bytes = await readWithin(resolve(root, path));
      totalBytes += bytes.length;
      if (totalBytes > 8_000_000) return missing();
      // A modified module is unknown, not an empty authoritative surface.
      if (digest(bytes) === hash) files.set(resolve(root, path), bytes);
    }
    const modules = new Map<string, PublicModule>();
    const active = new Set<string>();
    function findModule(path: string): string | undefined {
      return [path, `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}.jsx`, `${path}.vue`, resolve(path, "index.ts"), resolve(path, "index.js")].find(candidate => files.has(candidate));
    }
    function moduleAt(file: string): PublicModule | undefined {
      const cached = modules.get(file);
      if (cached) return cached;
      if (active.has(file)) return undefined;
      const bytes = files.get(file);
      if (bytes === undefined) return undefined;
      active.add(file);
      const exports = new Map<string, PublicSymbol>();
      let complete = true;
      const source = ts.createSourceFile(file, bytes, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const symbolFor = (name: string): PublicSymbol | undefined => {
        if (keywordNames.has(name)) return { kind: "keyword" };
        const stem = metadataTarget === "vanilla" && name.startsWith("create") && !ids.has(name) ? name.slice(6) : name;
        const id = ids.get(stem) ?? [...ids].find(([key]) => key.charAt(0).toLowerCase() + key.slice(1) === stem)?.[1];
        return id ? { kind: metadataTarget === "vanilla" ? "factory" : "component", iconId: id } : undefined;
      };
      for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement)) {
          if (statement.isTypeOnly) continue;
          const clause = statement.exportClause;
          const specifier = statement.moduleSpecifier;
          if (clause && ts.isNamespaceExport(clause)) {
            const childFile = specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".") ? findModule(resolve(dirname(file), specifier.text)) : undefined;
            const child = childFile ? moduleAt(childFile) : undefined;
            if (child?.complete) exports.set(clause.name.text, { kind: "namespace", members: child.exports });
            else complete = false;
          } else if (clause && ts.isNamedExports(clause)) {
            const childFile = specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".") ? findModule(resolve(dirname(file), specifier.text)) : undefined;
            const child = childFile ? moduleAt(childFile) : undefined;
            if (specifier && !child?.complete) complete = false;
            for (const element of clause.elements) {
              if (element.isTypeOnly) continue;
              const name = element.name.text;
              const imported = element.propertyName?.text ?? name;
              const own = specifier ? child?.exports.get(imported) : symbolFor(imported);
              if (own) exports.set(name, own);
              else if (specifier) complete = false;
              else exports.set(name, { kind: "keyword" });
            }
          } else complete = false;
        }
        if (ts.isExportAssignment(statement)) {
          const name = file.split(sep).pop()?.replace(/\.(tsx?|jsx?|vue)$/, "") ?? "";
          const own = symbolFor(name);
          if (own) exports.set("default", own);
          else complete = false;
        }
        if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
          if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) {
            if (ts.isIdentifier(item.name)) exports.set(item.name.text, symbolFor(item.name.text) ?? { kind: "keyword" });
          }
          else if (ts.isFunctionDeclaration(statement)) {
            const name = statement.name?.text ?? file.split(sep).pop()?.replace(/\.(tsx?|jsx?)$/, "") ?? "";
            const own = symbolFor(name) ?? { kind: "keyword" as const };
            if (ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) exports.set("default", own);
            else if (statement.name) exports.set(name, own);
          }
        }
      }
      // CLI Vue proxy SFCs are default components, not parseable TS modules.
      if (file.endsWith(".vue")) {
        const own = symbolFor(file.split(sep).pop()?.slice(0, -4) ?? "");
        if (own) exports.set("default", own);
        else complete = false;
      }
      const module = { exports, complete };
      modules.set(file, module);
      active.delete(file);
      return module;
    }
    const metadataTarget = metadata.target;
    for (const file of files.keys()) moduleAt(file);
    const canonicalPath = (path: string): string => inside(resolve(workspaceRoot), path) ? resolve(root, relative(resolve(workspaceRoot), path)) : path;
    return {
      owns: path => modules.has(canonicalPath(path)),
      version: metadata.artifactVersion, target: metadataTarget, modules,
      resolver(documentPath) {
        // macOS /var and /private/var can identify the same workspace.
        const canonicalDocument = canonicalPath(documentPath);
        return specifier => {
          // Relative generated modules only; arbitrary aliases/packages need a separate verified adapter.
          if (!specifier.startsWith(".")) return undefined;
          const candidate = resolve(dirname(canonicalDocument), specifier);
          if (!inside(root, candidate)) return undefined;
          const file = findModule(candidate);
          return file ? modules.get(file) : undefined;
        };
      },
    };
  } catch { return missing(); }
}
