import { readCliAccessToken, type SessionRead } from "./session";

export type AccountState =
  | { readonly kind: "signedOut" }
  | { readonly kind: "sessionExpired" }
  | { readonly kind: "unknown"; readonly reason: "unavailable" | "rateLimited" | "policy" | "sessionStore" }
  | { readonly kind: "authenticated"; readonly tier: "free" | "pro"; readonly status: "none" | "active" | "expired" | "revoked"; readonly effectivePro: boolean; readonly expiresAt: number };

interface AccountDependencies {
  readSession(): Promise<SessionRead>;
  request: typeof fetch;
  cacheMs: number;
}
const API_ORIGIN = "https://api.moeicons.com";
export class AccountService {
  private state: AccountState = { kind: "unknown", reason: "unavailable" };
  private validUntil = 0;
  private pending: Promise<AccountState> | undefined;
  private retryAfterUntil = 0;
  private listeners = new Set<(state: AccountState) => void>();
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private disposed = false;
  private readonly deps: AccountDependencies;
  constructor(deps: Partial<AccountDependencies> = {}) {
    this.deps = { readSession: readCliAccessToken, request: (...args) => fetch(...args), cacheMs: 60_000, ...deps };
  }
  get current(): AccountState { return this.state; }
  onDidChange(listener: (state: AccountState) => void): { dispose(): void } { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }
  private set(state: AccountState, cacheMs = this.deps.cacheMs): AccountState {
    if (this.disposed) return this.state;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (state.kind === "authenticated" && state.expiresAt <= Date.now()) state = { kind: "sessionExpired" };
    this.state = state;
    const lifetime = Math.max(0, Math.min(this.deps.cacheMs, cacheMs));
    this.validUntil = Date.now() + lifetime;
    if (state.kind === "authenticated") {
      this.expiryTimer = setTimeout(() => {
        this.expiryTimer = undefined;
        this.validUntil = 0;
        this.state = state.expiresAt <= Date.now() ? { kind: "sessionExpired" } : { kind: "unknown", reason: "unavailable" };
        for (const listener of this.listeners) listener(this.state);
      }, lifetime);
    }
    for (const listener of this.listeners) listener(state);
    return state;
  }
  refresh(force = false): Promise<AccountState> {
    if (this.disposed || Date.now() < this.retryAfterUntil) return Promise.resolve(this.state);
    if (this.pending) return this.pending;
    if (!force && Date.now() < this.validUntil) return Promise.resolve(this.state);
    const request = this.load().catch(() => this.set({ kind: "unknown", reason: "sessionStore" }, 10_000)).finally(() => { if (this.pending === request) this.pending = undefined; });
    this.pending = request;
    return request;
  }
  private async load(): Promise<AccountState> {
    const session = await this.deps.readSession();
    if (this.disposed) return this.state;
    if (session.kind !== "token") {
      if (session.kind === "signedOut") return this.set({ kind: "signedOut" });
      if (session.kind === "expired") return this.set({ kind: "sessionExpired" });
      return this.set({ kind: "unknown", reason: "sessionStore" }, 10_000);
    }
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.deps.request(`${API_ORIGIN}/v1/plugin/account`, { method: "GET", redirect: "error", signal: controller.signal, headers: { Authorization: `Bearer ${session.accessToken}`, "X-Moeicons-Plugin": "vscode", "Cache-Control": "no-cache" } });
      const body: unknown = response.ok ? await response.json() : undefined;
      // A response belongs only to the session that initiated it. Never apply an old account's rights.
      const latest = await this.deps.readSession();
      if (this.disposed) return this.state;
      if (latest.kind !== "token" || latest.accessToken !== session.accessToken || latest.expiresAt !== session.expiresAt) {
        if (latest.kind === "signedOut") return this.set({ kind: "signedOut" });
        if (latest.kind === "expired") return this.set({ kind: "sessionExpired" });
        return this.set({ kind: "unknown", reason: "sessionStore" }, 0);
      }
      if (response.status === 401) return this.set({ kind: "sessionExpired" });
      if (response.status === 429) {
        const raw = response.headers.get("Retry-After") ?? "1";
        const milliseconds = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
        const delay = Math.max(1_000, Math.min(900_000, Number.isFinite(milliseconds) ? milliseconds : 1_000));
        this.retryAfterUntil = Date.now() + delay;
        return this.set({ kind: "unknown", reason: "rateLimited" });
      }
      if (response.status === 403) return this.set({ kind: "unknown", reason: "policy" }, 10_000);
      if (!response.ok) return this.set({ kind: "unknown", reason: "unavailable" }, 10_000);
      if (typeof body !== "object" || body === null) return this.set({ kind: "unknown", reason: "unavailable" }, 10_000);
      const item = body as Record<string, unknown>;
      if (item.schemaVersion !== 1 || (item.tier !== "free" && item.tier !== "pro") || !["none", "active", "expired", "revoked"].includes(String(item.status))) return this.set({ kind: "unknown", reason: "unavailable" }, 10_000);
      const status = item.status as "none" | "active" | "expired" | "revoked";
      return this.set({ kind: "authenticated", tier: item.tier, status, effectivePro: item.tier === "pro" && status === "active", expiresAt: session.expiresAt }, session.expiresAt - Date.now());
    } catch { return this.set({ kind: "unknown", reason: "unavailable" }, 10_000); }
    finally { clearTimeout(timer); if (this.controller === controller) this.controller = undefined; }
  }
  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.listeners.clear(); this.validUntil = 0; this.retryAfterUntil = 0; this.state = { kind: "unknown", reason: "unavailable" };
  }
}
