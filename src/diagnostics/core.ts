import rawCodes from "../../data/error-codes.json";
import type { LanguageIssue } from "../language/contracts";
export interface ErrorCode {
  readonly key: string;
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly hint: string;
  readonly helpUrl: string;
}
export function loadErrorCodes(value: unknown = rawCodes): ReadonlyMap<string, ErrorCode> {
  if (!Array.isArray(value)) throw new Error("Invalid error code catalog");
  const entries = new Map<string, ErrorCode>();
  const codes = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) throw new Error("Invalid error code");
    const { key, code, severity, message, hint, helpUrl } = item;
    if (typeof key !== "string" || typeof code !== "string" || !/^MOE-ICON-\d{4}$/.test(code) ||
        (severity !== "error" && severity !== "warning" && severity !== "info") ||
        typeof message !== "string" || typeof hint !== "string" || typeof helpUrl !== "string" ||
        !helpUrl.startsWith("https://github.com/moewolf-dev/moe-icons-plugins") || entries.has(key) || codes.has(code)) throw new Error("Invalid or duplicate error code");
    entries.set(key, { key, code, severity, message, hint, helpUrl });
    codes.add(code);
  }
  return entries;
}
const codes = loadErrorCodes();
export function getErrorCode(key: string): ErrorCode | undefined { return codes.get(key); }
export function formatIssue(issue: LanguageIssue): { definition: ErrorCode; message: string } {
  const definition = codes.get(issue.key);
  if (!definition) throw new Error("Missing error code");
  return { definition, message: `${definition.message.replace("{name}", () => issue.name)} ${definition.hint}` };
}
