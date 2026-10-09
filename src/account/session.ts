import { selectedStore, missingCredential } from "./session-policy.cjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile, lstat } from "node:fs/promises";

const run = promisify(execFile);
export type SessionRead = { readonly kind: "token"; readonly accessToken: string; readonly expiresAt: number } | { readonly kind: "signedOut" | "expired" | "unknown" };

function parse(value: string): SessionRead {
  try {
    const raw: unknown = JSON.parse(value);
    if (typeof raw !== "object" || raw === null) return { kind: "unknown" };
    const session = raw as Record<string, unknown>;
    if (typeof session.accountId !== "string" || typeof session.accessToken !== "string" ||
        typeof session.refreshToken !== "string" || typeof session.expiresAt !== "number" || !Number.isFinite(session.expiresAt) ||
        typeof session.scope !== "string" || typeof session.storedAt !== "number" || !Number.isFinite(session.storedAt)) return { kind: "unknown" };
    if (session.expiresAt <= Date.now()) return { kind: "expired" };
    return { kind: "token", accessToken: session.accessToken, expiresAt: session.expiresAt };
  } catch { return { kind: "unknown" }; }
}

export async function readKeychain(): Promise<SessionRead> {
  const platform = process.platform;
  try {
    let value: string;
    if (platform === "darwin") {
      ({ stdout: value } = await run("security", ["find-generic-password", "-s", "moeicons", "-a", "active-session", "-w"], { timeout: 2500, maxBuffer: 64_000 }));
    } else if (platform === "linux") {
      ({ stdout: value } = await run("secret-tool", ["lookup", "service", "moeicons", "account", "active-session"], { timeout: 2500, maxBuffer: 64_000 }));
    } else if (platform === "win32") {
      const prefix = "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];$v=[Windows.Security.Credentials.PasswordVault]::new();try{$c=$v.Retrieve('moeicons','active-session');$c.RetrievePassword();[Console]::Out.Write($c.Password)}catch{$e=$_.Exception;while($e){if($e.HResult -eq -2147023728){exit 44};$e=$e.InnerException};exit 45}";
      ({ stdout: value } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", prefix], { timeout: 2500, maxBuffer: 64_000 }));
    } else return { kind: "unknown" };
    return parse(value.trim());
  } catch (error) { return { kind: missingCredential(platform, error as never) ? "signedOut" : "unknown" }; }
}

/** Mirrors CLI store selection: never fall back to a file after keychain failure. */
export async function readCliAccessToken(): Promise<SessionRead> {
  let selection: ReturnType<typeof selectedStore>;
  try { selection = selectedStore(process.env); } catch { return { kind: "unknown" }; }
  if (selection.mode === "none") return { kind: "signedOut" };
  if (selection.mode === "file") {
    const configured = selection.rootDir!;
    try {
      const file = join(configured, "token-store.json");
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) return { kind: "unknown" };
      if (metadata.size > 1_000_000) return { kind: "unknown" };
      const value = await readFile(file, "utf8");
      const raw: unknown = JSON.parse(value);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { kind: "unknown" };
      const sessions = Object.values(raw as Record<string, unknown>);
      if (sessions.some(item => parse(JSON.stringify(item)).kind === "unknown")) return { kind: "unknown" };
      if (sessions.length === 0) return { kind: "signedOut" };
      const active = sessions.map(item => item as Record<string, unknown>).sort((a, b) => Number(b.storedAt) - Number(a.storedAt))[0];
      return parse(JSON.stringify(active));
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "signedOut" } : { kind: "unknown" };
    }
  }
  return readKeychain();
}
