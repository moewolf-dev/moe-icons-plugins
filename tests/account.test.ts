import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountService } from "../src/account/service";
import type { SessionRead } from "../src/account/session";

const token = (): SessionRead => ({ kind: "token", accessToken: "fixture-token", expiresAt: Date.now() + 60_000 });
const rights = () => Response.json({ schemaVersion: 1, tier: "pro", status: "active" });

test("account rights expire to unknown and notify subscribers", async () => {
  const session = token();
  const account = new AccountService({ readSession: async () => session, request: async () => rights(), cacheMs: 20 });
  const changes: string[] = [];
  account.onDidChange(state => changes.push(state.kind));
  try {
    assert.equal((await account.refresh()).kind, "authenticated");
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(account.current.kind, "unknown");
    assert.deepEqual(changes, ["authenticated", "unknown"]);
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
  assert.equal(account.current.kind, "unknown");
  assert.equal(changes, 0);
});

test("concurrent refreshes share one request and Retry-After suppresses retries", async () => {
  const session = token();
  let calls = 0;
  const account = new AccountService({ readSession: async () => session, request: async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "60" } }); } });
  try {
    const first = account.refresh();
    assert.equal(account.refresh(true), first);
    assert.equal((await first).kind, "unknown");
    await account.refresh(true);
    assert.equal(calls, 1);
  } finally { account.dispose(); }
});
