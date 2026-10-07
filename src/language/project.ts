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
  watches(documentPath: string): boolean;
  readonly styleGroups?: readonly string[];
  resolver(documentPath: string): ModuleResolver;
}
const missing = (): ProjectSnapshot => ({ modules: new Map(), owns: () => false, watches: path => path.includes("/.moeicons/") || /(?:ts|js)config.*\.json$/.test(path), resolver: () => () => undefined });

export { findManagedProjectRoot } from "./project-root";

/** Only hashed CLI-managed modules are authoritative. Never execute project config. */
export async function readProjectSnapshot(workspaceRoot: string): Promise<ProjectSnapshot> {
  try {
    const root = await realpath(workspaceRoot);
    async function readWithin(path: string, maxBytes = 2_000_000): Promise<string> {
      const file = await realpath(path);
      if (!inside(root, file) || (await stat(file)).size > maxBytes) throw new Error("Untrusted project input");
      return readFile(file, "utf8");
    }
    const metadata: unknown = JSON.parse(await readWithin(resolve(root, ".moeicons/install-metadata.json"), 8_000_000));
    if (!record(metadata) || metadata.schemaVersion !== 1 || !target(metadata.target) || typeof metadata.artifactVersion !== "string" || !record(metadata.managedFiles)) return missing();
    const outputDir = metadata.generatedOutputDir;
    if (typeof outputDir !== "string" || !safePath(outputDir)) return missing();
    const managed = metadata.managedFiles;
    const catalogText = await readWithin(resolve(root, ".moeicons/catalog.json"));
    if (digest(catalogText) !== metadata.catalogSha256 || metadata.catalogSha256 !== managed[".moeicons/catalog.json"]) return missing();
    const catalog: unknown = JSON.parse(catalogText);
    if (!record(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.icons)) return missing();
    const ids = new Map<string, string>();
    const names = new Map<string, string>();
    for (const icon of catalog.icons) if (record(icon) && typeof icon.id === "string") {
      const name = proxyName(icon.id);
      // Ambiguous names must not produce a false icon identity.
      if (ids.has(name) && ids.get(name) !== icon.id) return missing();
      ids.set(name, icon.id);
      names.set(name, icon.id); names.set(name.charAt(0).toLowerCase() + name.slice(1), icon.id);
    }
    const files = new Map<string, string>();
    const candidates = Object.entries(managed).filter(([path, hash]) => path.startsWith(`${outputDir}/`) && safePath(path) && /\.(?:ts|tsx|js|jsx|vue)$/.test(path) && typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));
    if (candidates.length > 3000) return missing();
    let totalBytes = 0;
    for (const [path, hash] of candidates) {
      const bytes = await readWithin(resolve(root, path));
      totalBytes += Buffer.byteLength(bytes);
      if (totalBytes > 8_000_000) return missing();
      // A modified module is unknown, not an empty authoritative surface.
      if (digest(bytes) === hash) files.set(resolve(root, path), bytes);
    }
    // Follow only artifact modules actually re-exported by generated proxies.
    // Full installations may contain thousands of other icons; do not read them.
    const artifacts = new Map(Object.entries(managed).filter(([path, hash]) => path.startsWith(`.moeicons/artifact/${metadata.target}/`) && safePath(path) && /\.(?:ts|tsx|js|jsx|vue)$/.test(path) && typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)).map(([path, hash]) => [resolve(root, path), hash]));
    const sources = new Map<string, ts.SourceFile>();
    const pending = [...files.keys()];
    const owned = new Set(candidates.map(([name]) => resolve(root, name)));
    for (let index = 0; index < pending.length; index++) {
      const file = pending[index];
      const source = ts.createSourceFile(file, files.get(file)!, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      sources.set(file, source);
      for (const statement of source.statements) {
        if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith(".")) continue;
        const base = resolve(dirname(file), statement.moduleSpecifier.text);
        const artifact = [base, `${base}.js`, `${base}.ts`, resolve(base, "index.js"), resolve(base, "index.ts")].find(path => artifacts.has(path));
        if (!artifact || owned.has(artifact)) continue;
        owned.add(artifact);
        if (owned.size > 3000) return missing();
        const bytes = await readWithin(artifact);
        totalBytes += Buffer.byteLength(bytes);
        if (totalBytes > 8_000_000) return missing();
        if (digest(bytes) === artifacts.get(artifact)) { files.set(artifact, bytes); pending.push(artifact); }
      }
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
      const source = sources.get(file) ?? ts.createSourceFile(file, bytes, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const symbolFor = (name: string): PublicSymbol | undefined => {
        if (keywordNames.has(name)) return { kind: "keyword" };
        const stem = metadataTarget === "vanilla" && name.startsWith("create") && !ids.has(name) ? name.slice(6) : name;
        const id = names.get(stem);
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
              const own = specifier ? child?.exports.get(imported) : symbolFor(imported) ?? symbolFor(name) ?? (name === "default" ? symbolFor(file.split(sep).pop()?.replace(/\.(tsx?|jsx?|vue)$/, "") ?? "") : undefined);
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
    const aliases: { prefix: string; suffix: string; targets: string[]; base: string; wildcard: boolean }[] = [];
    const configs: string[] = [];
    // Read bounded JSONC only; never load JS or invoke TypeScript resolution.
    for (const name of ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"]) {
      const file = resolve(root, name); configs.push(file);
      try {
        const parsed = ts.parseConfigFileTextToJson(file, await readWithin(file));
        const options = parsed.config?.compilerOptions;
        if (parsed.error || !record(options) || !record(options.paths)) continue;
        const base = resolve(root, typeof options.baseUrl === "string" ? options.baseUrl : ".");
        if (!inside(root, base)) continue;
        for (const [key, paths] of Object.entries(options.paths)) {
          if ((key.match(/\*/g) ?? []).length > 1 || !Array.isArray(paths) || !paths.every(path => typeof path === "string" && (path.match(/\*/g) ?? []).length <= 1)) continue;
          const [prefix, suffix = ""] = key.split("*");
          aliases.push({ prefix, suffix, targets: paths, base, wildcard: key.includes("*") });
        }
      } catch { /* Optional aliases; unknown paths retain conservative behaviour. */ }
    }
    const metadataTarget = metadata.target;
    for (const file of files.keys()) moduleAt(file);
    const canonicalPath = (path: string): string => inside(resolve(workspaceRoot), path) ? resolve(root, relative(resolve(workspaceRoot), path)) : path;
    return {
      owns: path => owned.has(canonicalPath(path)),
      watches: path => { const file = canonicalPath(path); return file.startsWith(resolve(root, outputDir) + sep) || file.startsWith(resolve(root, ".moeicons") + sep) || configs.includes(file); },
      styleGroups: Array.isArray(catalog.styleGroups) ? catalog.styleGroups.filter(record).flatMap(group => typeof group.id === "string" ? [group.id] : []) : [],
      version: metadata.artifactVersion, target: metadataTarget, modules,
      resolver(documentPath) {
        // macOS /var and /private/var can identify the same workspace.
        const canonicalDocument = canonicalPath(documentPath);
        return specifier => {
          const candidates = specifier.startsWith(".") ? [resolve(dirname(canonicalDocument), specifier)] : aliases.flatMap(alias => {
            if ((!alias.wildcard && specifier !== alias.prefix) || !specifier.startsWith(alias.prefix) || !specifier.endsWith(alias.suffix)) return [];
            const middle = specifier.slice(alias.prefix.length, alias.suffix ? -alias.suffix.length : undefined);
            return alias.targets.map(target => resolve(alias.base, target.replace("*", middle)));
          });
          for (const candidate of candidates) {
            if (!inside(root, candidate)) continue;
            const file = findModule(candidate);
            if (file) return modules.get(file);
          }
          return undefined;
        };
      },
    };
  } catch { return missing(); }
}
