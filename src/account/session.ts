import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";

const run = promisify(execFile);
export type SessionRead = { readonly kind: "token"; readonly accessToken: string; readonly expiresAt: number } | { readonly kind: "signedOut" | "expired" | "unknown" };

function parse(value: string): SessionRead {
  try {
    const raw: unknown = JSON.parse(value);
    if (typeof raw !== "object" || raw === null) return { kind: "unknown" };
    const session = raw as Record<string, unknown>;
    if (typeof session.accessToken !== "string" || typeof session.expiresAt !== "number" || !Number.isFinite(session.expiresAt)) return { kind: "unknown" };
    if (session.expiresAt <= Date.now()) return { kind: "expired" };
    return { kind: "token", accessToken: session.accessToken, expiresAt: session.expiresAt };
  } catch { return { kind: "unknown" }; }
}

async function readKeychain(): Promise<SessionRead> {
  const platform = process.platform;
  try {
    let value: string;
    if (platform === "darwin") {
      ({ stdout: value } = await run("security", ["find-generic-password", "-s", "moeicons", "-a", "active-session", "-w"], { timeout: 2500, maxBuffer: 64_000 }));
    } else if (platform === "linux") {
      ({ stdout: value } = await run("secret-tool", ["lookup", "service", "moeicons", "account", "active-session"], { timeout: 2500, maxBuffer: 64_000 }));
    } else if (platform === "win32") {
      const prefix = "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime];$v=[Windows.Security.Credentials.PasswordVault]::new();$c=$v.Retrieve('moeicons','active-session');$c.RetrievePassword();[Console]::Out.Write($c.Password)";
      ({ stdout: value } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", prefix], { timeout: 2500, maxBuffer: 64_000 }));
    } else return { kind: "unknown" };
    return parse(value.trim());
  } catch { return { kind: "unknown" }; }
}

/** Mirrors CLI store selection: never fall back to a file after keychain failure. */
export async function readCliAccessToken(): Promise<SessionRead> {
  if (process.env.MOEICONS_DISABLE_SYSTEM_KEYCHAIN === "1") {
    const configured = process.env.MOEICONS_TOKEN_STORE_DIR;
    if (!configured) return { kind: "signedOut" };
    try {
      const file = join(configured, "token-store.json");
      const metadata = await stat(file);
      if ((metadata.mode & 0o077) !== 0 || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) return { kind: "unknown" };
      if (metadata.size > 1_000_000) return { kind: "unknown" };
      const value = await readFile(file, "utf8");
      const raw: unknown = JSON.parse(value);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { kind: "unknown" };
      const sessions = Object.values(raw as Record<string, unknown>).filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).storedAt === "number").sort((a, b) => Number(b.storedAt) - Number(a.storedAt));
      return sessions.length ? parse(JSON.stringify({ accessToken: sessions[0].accessToken, expiresAt: sessions[0].expiresAt })) : { kind: "signedOut" };
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "signedOut" } : { kind: "unknown" };
    }
  }
  return readKeychain();
}
