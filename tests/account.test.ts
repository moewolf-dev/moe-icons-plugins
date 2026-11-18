import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountService } from "../src/account/service";
import type { SessionRead } from "../src/account/session";

const token = (): SessionRead => ({ kind: "token", accessToken: "fixture-token", expiresAt: Date.now() + 60_000 });
const rights = (tier: "free" | "pro" = "pro", status: "none" | "active" | "expired" | "revoked" = "active") =>
  Response.json({ schemaVersion: 1, tier, status });

test("account rights expire to unavailable and notify subscribers", async () => {
  const session = token();
  const account = new AccountService({ readSession: async () => session, request: async () => rights(), cacheMs: 20 });
  const changes: string[] = [];
  account.onDidChange(state => changes.push(state.kind));
  try {
    assert.equal((await account.refresh()).kind, "authenticated");
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(account.current.kind, "unavailable");
    assert.deepEqual(changes, ["authenticated", "unavailable"]);
  } finally { account.dispose(); }
});

test("logout while an account response is in flight cannot apply old Pro rights", async () => {
  let session = token();
  let respond!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { respond = resolve; });
  const account = new AccountService({ readSession: async () => session, request: async () => response });
  try {
    const pending = account.refresh();
    await new Promise(resolve => setImmediate(resolve));
    session = { kind: "signedOut" };
    respond(rights());
    assert.equal((await pending).kind, "signedOut");
  } finally { account.dispose(); }
});

test("dispose aborts the request and prevents late state updates", async () => {
  let signal: AbortSignal | undefined;
  let respond!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { respond = resolve; });
  const account = new AccountService({ readSession: async () => token(), request: async (_url, init) => { signal = init?.signal ?? undefined; return response; } });
  let changes = 0;
  account.onDidChange(() => changes++);
  const pending = account.refresh();
  await new Promise(resolve => setImmediate(resolve));
  account.dispose();
  assert.equal(signal?.aborted, true);
  respond(rights());
  await pending;
  assert.equal(account.current.kind, "unavailable");
  assert.equal(changes, 0);
});

test("concurrent refreshes share one request and Retry-After suppresses retries", async () => {
  const session = token();
  let calls = 0;
  const account = new AccountService({ readSession: async () => session, request: async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "60" } }); } });
  try {
    const first = account.refresh();
    assert.equal(account.refresh(true), first);
    const state = await first;
    assert.equal(state.kind, "rateLimited");
    if (state.kind === "rateLimited") assert.ok(state.retryAfterMs >= 60_000);
    await account.refresh(true);
    assert.equal(calls, 1);
  } finally { account.dispose(); }
});

test("signedOut, sessionExpired, sessionStore, rateLimited, policy and unavailable are independent", async () => {
  const cases: Array<{ name: string; session: SessionRead; response?: () => Promise<Response>; expected: string }> = [
    { name: "signed out", session: { kind: "signedOut" }, expected: "signedOut" },
    { name: "expired session", session: { kind: "expired" }, expected: "sessionExpired" },
    { name: "missing keychain tool", session: { kind: "unknown", reason: "keychainToolMissing" }, expected: "sessionStore" },
    { name: "corrupt session", session: { kind: "unknown", reason: "corruptSession" }, expected: "sessionStore" },
    { name: "unreadable store", session: { kind: "unknown", reason: "sessionStore" }, expected: "sessionStore" },
    { name: "unauthorized response", session: token(), response: async () => new Response(null, { status: 401 }), expected: "sessionExpired" },
    { name: "policy response", session: token(), response: async () => new Response(null, { status: 403 }), expected: "policy" },
    { name: "service unavailable", session: token(), response: async () => new Response(null, { status: 503 }), expected: "unavailable" },
    { name: "network failure", session: token(), response: async () => { throw new Error("offline fixture"); }, expected: "unavailable" },
    { name: "invalid account body", session: token(), response: async () => Response.json({ schemaVersion: 99, tier: "pro", status: "active" }), expected: "unavailable" },
  ];
  for (const item of cases) {
    const account = new AccountService({
      readSession: async () => item.session,
      request: item.response ?? (async () => rights()),
    });
    try {
      const state = await account.refresh();
      assert.equal(state.kind, item.expected, item.name);
      if (state.kind === "sessionStore" && item.session.kind === "unknown") assert.equal(state.reason, item.session.reason, item.name);
    } finally { account.dispose(); }
  }
});

test("Free and Pro entitlement are reported without guessing", async () => {
  const freeSession = token();
  const free = new AccountService({ readSession: async () => freeSession, request: async () => rights("free", "active") });
  try {
    const state = await free.refresh();
    assert.equal(state.kind, "authenticated");
    if (state.kind === "authenticated") {
      assert.equal(state.tier, "free");
      assert.equal(state.effectivePro, false);
    }
  } finally { free.dispose(); }

  const proSession = token();
  const pro = new AccountService({ readSession: async () => proSession, request: async () => rights("pro", "active") });
  try {
    const state = await pro.refresh();
    assert.equal(state.kind, "authenticated");
    if (state.kind === "authenticated") {
      assert.equal(state.tier, "pro");
      assert.equal(state.effectivePro, true);
    }
  } finally { pro.dispose(); }

  const expiredSession = token();
  const expiredPro = new AccountService({ readSession: async () => expiredSession, request: async () => rights("pro", "expired") });
  try {
    const state = await expiredPro.refresh();
    assert.equal(state.kind, "authenticated");
    if (state.kind === "authenticated") assert.equal(state.effectivePro, false);
  } finally { expiredPro.dispose(); }
});
