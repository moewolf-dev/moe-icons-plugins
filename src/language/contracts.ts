/** Verified public exports, never SVG or bitmap content. */
export type LanguageTarget = "react" | "vue" | "vanilla" | "assets";
export type PublicSymbol =
  | { readonly kind: "component" | "factory" | "keyword" | "asset"; readonly iconId?: string; readonly requiresPro?: boolean }
  | { readonly kind: "namespace"; readonly members: ReadonlyMap<string, PublicSymbol> };
export interface PublicModule {
  readonly exports: ReadonlyMap<string, PublicSymbol>;
  /** True only for a complete, locally verified export surface. */
  readonly complete: boolean;
}
export type ModuleResolver = (specifier: string) => PublicModule | undefined;
export interface SymbolOccurrence {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly symbol: PublicSymbol;
}
export interface LanguageIssue {
  readonly key: "UNKNOWN_ICON" | "INVALID_SYMBOL_NAME" | "MALFORMED_USAGE" | "ACCOUNT_TIER_MISMATCH";
  readonly start: number;
  readonly end: number;
  readonly name: string;
}
export interface CompletionCandidate {
  readonly name: string;
  readonly symbol: PublicSymbol;
  readonly start: number;
  readonly end: number;
}
