import { test } from "node:test";
import assert from "node:assert/strict";
import { accountGuidance, remoteHostKind, remoteHostNote } from "../src/account/guidance";
import type { AccountState } from "../src/account/service";

test("every non-authenticated account state has an independent code and actionable hint", () => {
  const cases: Array<{ state: AccountState; key: string; code: string; action: RegExp }> = [
    { state: { kind: "signedOut" }, key: "ACCOUNT_SIGNED_OUT", code: "MOE-ICON-0008", action: /moeicons login/ },
    { state: { kind: "sessionExpired" }, key: "ACCOUNT_SESSION_EXPIRED", code: "MOE-ICON-0006", action: /moeicons login/ },
    { state: { kind: "sessionStore", reason: "keychainToolMissing" }, key: "ACCOUNT_SESSION_STORE", code: "MOE-ICON-0009", action: /secret-tool|security|PasswordVault/ },
    { state: { kind: "sessionStore", reason: "corruptSession" }, key: "ACCOUNT_SESSION_STORE", code: "MOE-ICON-0009", action: /moeicons login/ },
    { state: { kind: "sessionStore", reason: "sessionStore" }, key: "ACCOUNT_SESSION_STORE", code: "MOE-ICON-0009", action: /permissions|moeicons login/ },
    { state: { kind: "rateLimited", retryAfterMs: 42_000 }, key: "ACCOUNT_RATE_LIMITED", code: "MOE-ICON-0010", action: /Retry after about 42s/ },
    { state: { kind: "policy" }, key: "ACCOUNT_POLICY", code: "MOE-ICON-0011", action: /Node\.js 24/ },
    { state: { kind: "unavailable" }, key: "ACCOUNT_UNAVAILABLE", code: "MOE-ICON-0007", action: /Node\.js 24/ },
  ];
  for (const item of cases) {
    const guidance = accountGuidance(item.state);
    assert.equal(guidance.key, item.key);
    assert.equal(guidance.code, item.code);
    assert.match(guidance.hint, item.action);
    assert.ok(guidance.steps.length > 0, item.key);
  }
});

test("authenticated Free and Pro states are descriptive without error codes", () => {
  const free = accountGuidance({ kind: "authenticated", tier: "free", status: "active", effectivePro: false, expiresAt: Date.now() + 60_000 });
  assert.equal(free.key, "ACCOUNT_AUTHENTICATED");
  assert.equal(free.code, undefined);
  assert.match(free.title, /Free/);
  assert.match(free.hint, /Pro/);

  const pro = accountGuidance({ kind: "authenticated", tier: "pro", status: "active", effectivePro: true, expiresAt: Date.now() + 60_000 });
  assert.match(pro.title, /Pro \(active\)/);

  const inactive = accountGuidance({ kind: "authenticated", tier: "pro", status: "expired", effectivePro: false, expiresAt: Date.now() + 60_000 });
  assert.match(inactive.title, /Pro \(inactive\)/);
});

test("Remote SSH, WSL, container and remote hosts explain the keychain boundary", () => {
  assert.equal(remoteHostKind(undefined), "local");
  assert.equal(remoteHostKind("ssh-remote"), "ssh");
  assert.equal(remoteHostKind("wsl"), "wsl");
  assert.equal(remoteHostKind("dev-container"), "container");
  assert.equal(remoteHostKind("attached-container"), "container");
  assert.equal(remoteHostKind("codespaces"), "remote");
  for (const remoteName of ["ssh-remote", "wsl", "dev-container", "codespaces"]) {
    const note = remoteHostNote(remoteName);
    assert.ok(note, remoteName);
    assert.match(note, /credential store/);
    assert.match(note, /same host/);
    assert.match(note, /local credentials are not copied/);
    const guidance = accountGuidance({ kind: "signedOut" }, { remoteName });
    assert.equal(guidance.remoteNote, note);
  }
  assert.equal(remoteHostNote(undefined), undefined);
});
