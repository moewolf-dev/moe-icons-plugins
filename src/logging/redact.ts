/**
 * Redaction for the Moe Icons output channel. It is intentionally conservative:
 * it is better to hide a benign string than to write a token or home path to a
 * panel that users may paste into an issue.
 */
export const REDACTED = "[redacted]";

export interface RedactOptions {
  /** Current user's home directory, if known. Never echoed back. */
  readonly homeDir?: string;
}

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const SVG_SOURCE = /<svg[\s\S]*?<\/svg>/gi;
const DATA_URI = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const SECRET_PAIR = /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|authorization|password|secret|api[_-]?key|client[_-]?secret)\b("?)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;
const QUERY_SECRET = /([?&](?:token|access_token|refresh_token|id_token|code|signature|sig|key|api_key)=)[^&\s#]+/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const HOME_PATHS = [
  /\/Users\/[^/\s"'`]+/g,
  /\/home\/[^/\s"'`]+/g,
  /[A-Za-z]:\\Users\\[^\\\s"'`]+/g,
];

function redactHome(value: string, homeDir?: string): string {
  let result = value;
  if (homeDir !== undefined && homeDir.length > 1) result = result.split(homeDir).join("[home]");
  for (const pattern of HOME_PATHS) result = result.replace(pattern, "[home]");
  return result;
}

export function redactText(value: string, options: RedactOptions = {}): string {
  let result = value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value;
  result = result.replace(PRIVATE_KEY, "[redacted-private-key]");
  result = result.replace(SVG_SOURCE, "[redacted-icon-source]");
  result = result.replace(DATA_URI, "[redacted-data-uri]");
  result = redactHome(result, options.homeDir);
  result = result.replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`);
  result = result.replace(JWT, REDACTED);
  result = result.replace(SECRET_PAIR, (_match, key: string, quote: string, separator: string) => `${key}${quote}${separator}${REDACTED}`);
  result = result.replace(QUERY_SECRET, (_match, key: string) => `${key}${REDACTED}`);
  result = result.replace(EMAIL, "[redacted-email]");
  return result;
}

/**
 * Only allow short, non-sensitive diagnostic fields. Unknown keys, objects and
 * arrays are dropped, which structurally prevents session JSON, network bodies
 * and icon source from reaching the output channel.
 */
const SAFE_DETAIL_KEYS = new Set([
  "attempt",
  "artifactVersion",
  "catalogSchema",
  "cliVersion",
  "code",
  "contractStatus",
  "count",
  "detail",
  "diagnosticEnabled",
  "durationMs",
  "enabled",
  "entitlement",
  "hostKind",
  "httpStatus",
  "installedCliVersion",
  "metadataSchema",
  "phase",
  "pluginVersion",
  "reason",
  "remote",
  "resourceVersion",
  "retryAfterMs",
  "schema",
  "schemaVersion",
  "state",
  "status",
  "target",
  "tier",
]);

export type LogDetail = Readonly<Record<string, string | number | boolean | undefined>>;

export function sanitizeDetail(detail: LogDetail | undefined, options: RedactOptions = {}): string | undefined {
  if (!detail) return undefined;
  const parts: string[] = [];
  for (const key of Object.keys(detail).sort()) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue;
    const value = detail[key];
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    const text = redactText(String(value), options).replace(/[\r\n\t]+/g, " ").slice(0, 120);
    parts.push(`${key}=${text}`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}
