import { getErrorCode } from "../diagnostics/core";
import type { AccountState } from "./service";

export type RemoteHostKind = "local" | "ssh" | "wsl" | "container" | "remote";

export interface HostInfo {
  readonly remoteName?: string;
}

export interface AccountGuidance {
  /** Stable key for tests and views; authenticated states have no error code. */
  readonly key: string;
  readonly code?: string;
  readonly severity: "error" | "warning" | "info";
  readonly title: string;
  readonly hint: string;
  readonly steps: readonly string[];
  readonly remoteNote?: string;
}

export function remoteHostKind(remoteName?: string): RemoteHostKind {
  const value = (remoteName ?? "").toLowerCase();
  if (value.length === 0) return "local";
  if (value.includes("ssh")) return "ssh";
  if (value.includes("wsl")) return "wsl";
  if (value.includes("container") || value.includes("docker")) return "container";
  return "remote";
}

/**
 * The extension reads the extension host's OS credential store. Remote hosts
 * do not inherit the local machine's keychain/session.
 */
export function remoteHostNote(remoteName?: string): string | undefined {
  const kind = remoteHostKind(remoteName);
  if (kind === "local") return undefined;
  const host = kind === "ssh" ? "Remote SSH host" : kind === "wsl" ? "WSL distribution" : kind === "container" ? "container" : "remote host";
  return `${host}: this extension reads that host's OS credential store. Run \`moeicons login\` in a terminal on the same host and install the CLI there; local credentials are not copied.`;
}

const definitionFor = (key: string): { code: string; severity: "error" | "warning" | "info"; hint: string } => {
  const definition = getErrorCode(key);
  if (!definition) throw new Error(`Missing account error code ${key}`);
  return definition;
};

const loginSteps = [
  "Run `moeicons login` in a terminal on this VS Code host.",
  "Refresh the Moe Icons account view.",
  "Remote SSH, WSL and containers need their own login; local credentials are not copied.",
];

const storeSteps = [
  "Run `moeicons login` again to replace an unreadable session.",
  "On Linux install `libsecret-tools` (`secret-tool`); on macOS ensure the `security` command works; on Windows ensure PowerShell PasswordVault access.",
  "Run `moeicons doctor` if the keychain or session store problem persists.",
];

const upgradeSteps = [
  "Upgrade to Node.js 24 or newer and reopen the terminal.",
  "Reinstall or upgrade the Moeicons CLI: `npm install -D @moewolf/moe-icons-cli@latest`.",
  "Run `moeicons doctor`, then retry the account refresh.",
];

export function accountGuidance(state: AccountState, host: HostInfo = {}): AccountGuidance {
  const remoteNote = remoteHostNote(host.remoteName);
  const withRemote = (guidance: AccountGuidance): AccountGuidance =>
    remoteNote === undefined ? guidance : { ...guidance, remoteNote };

  if (state.kind === "authenticated") {
    const activePro = state.effectivePro;
    return withRemote({
      key: "ACCOUNT_AUTHENTICATED",
      severity: "info",
      title: activePro ? "Signed in: Pro (active)" : state.tier === "pro" ? "Signed in: Pro (inactive)" : "Signed in: Free",
      hint: activePro
        ? "Pro resources are available for this account."
        : state.tier === "pro"
          ? "The Pro entitlement is not active. Free features remain available; renew or check the plan on moeicons.com."
          : "Free features are available. Pro icons require an active Pro subscription.",
      steps: [],
    });
  }

  if (state.kind === "signedOut") {
    const definition = definitionFor("ACCOUNT_SIGNED_OUT");
    return withRemote({ key: "ACCOUNT_SIGNED_OUT", code: definition.code, severity: definition.severity, title: "Not signed in", hint: definition.hint, steps: loginSteps });
  }
  if (state.kind === "sessionExpired") {
    const definition = definitionFor("ACCOUNT_SESSION_EXPIRED");
    return withRemote({ key: "ACCOUNT_SESSION_EXPIRED", code: definition.code, severity: definition.severity, title: "Session expired", hint: definition.hint, steps: loginSteps });
  }
  if (state.kind === "sessionStore") {
    const definition = definitionFor("ACCOUNT_SESSION_STORE");
    const hint = state.reason === "keychainToolMissing"
      ? "The OS credential helper used by the CLI is missing or inaccessible. Install/repair it (`secret-tool`/libsecret on Linux, `security` on macOS, PowerShell PasswordVault on Windows), then run `moeicons login` again. If this is a Remote SSH/WSL/container window, do this on that host."
      : state.reason === "corruptSession"
        ? "The CLI session data is corrupt. Run `moeicons login` again to replace it; if it repeats, run `moeicons doctor`."
        : "The CLI session store could not be read safely (permissions, symlink, or an unsupported store). Check permissions or run `moeicons login` again.";
    return withRemote({ key: "ACCOUNT_SESSION_STORE", code: definition.code, severity: definition.severity, title: "Session store unavailable", hint, steps: storeSteps });
  }
  if (state.kind === "rateLimited") {
    const definition = definitionFor("ACCOUNT_RATE_LIMITED");
    const seconds = Math.max(1, Math.ceil(state.retryAfterMs / 1000));
    return withRemote({
      key: "ACCOUNT_RATE_LIMITED",
      code: definition.code,
      severity: definition.severity,
      title: "Account refresh rate limited",
      hint: `${definition.hint} Retry after about ${seconds}s.`,
      steps: ["Wait for the retry window to pass, then refresh the account view.", "Do not run `moeicons login` repeatedly; that does not reset the limit."],
    });
  }
  if (state.kind === "policy") {
    const definition = definitionFor("ACCOUNT_POLICY");
    return withRemote({
      key: "ACCOUNT_POLICY",
      code: definition.code,
      severity: definition.severity,
      title: "Account request rejected by policy",
      hint: definition.hint,
      steps: ["Verify the account and plan state on moeicons.com.", ...upgradeSteps],
    });
  }
  const definition = definitionFor("ACCOUNT_UNAVAILABLE");
  return withRemote({
    key: "ACCOUNT_UNAVAILABLE",
    code: definition.code,
    severity: definition.severity,
    title: "Account status unavailable",
    hint: definition.hint,
    steps: ["Check the network, proxy and clock, then refresh the account view.", ...upgradeSteps],
  });
}
