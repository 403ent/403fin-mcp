import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { platform } from "node:os";
import { SERVER_NAME, VERSION } from "../version.js";
import type { TokenEntry, TokenStore } from "./tokenstore.js";
import type { CredentialProvider } from "./types.js";

/** base64url without padding. */
export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE pair: verifier = 32 random bytes (base64url), challenge = S256(verifier). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** A random anti-CSRF state value (32 bytes, base64url). */
export function generateState(): string {
  return base64url(randomBytes(32));
}

/** Constant-time string comparison for the returned OAuth state. */
export function statesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface OAuthDeps {
  baseUrl: string;
  store: TokenStore;
  /**
   * Space-delimited scope string. Omitted by default: the Authorization Server
   * validates every requested scope against its registry and rejects unknown
   * ones outright, and an absent scope means "all read scopes, no writes".
   * Refresh tokens are issued regardless of what is requested here.
   */
  scope?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. Defaults to a detached OS browser opener. */
  openBrowser?: (url: string) => void;
  /** Injectable clock (epoch ms). */
  now?: () => number;
  /** Loopback-callback timeout in ms. */
  callbackTimeoutMs?: number;
}

const SUCCESS_HTML =
  '<!doctype html><meta charset=utf-8><title>Forbidden Finance</title><body style="font-family:system-ui;margin:3rem"><h2>Signed in to Forbidden Finance</h2><p>You can close this tab and return to your app.</p></body>';
const ERROR_HTML =
  '<!doctype html><meta charset=utf-8><title>Forbidden Finance</title><body style="font-family:system-ui;margin:3rem"><h2>Sign-in could not be completed</h2><p>Return to your app and try again.</p></body>';

function defaultOpenBrowser(url: string): void {
  const plat = platform();
  const cmd = plat === "darwin" ? "open" : plat === "win32" ? "cmd" : "xdg-open";
  const args = plat === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      // headless / no browser — the callback wait will time out with guidance.
    });
    child.unref();
  } catch {
    // ignore
  }
}

/**
 * OAuth 2.1 credential provider: dynamic client registration, authorization-code
 * flow with S256 PKCE + state over a 127.0.0.1 loopback listener, and single-use
 * refresh-token rotation serialized behind one in-flight refresh.
 */
export class OAuthProvider implements CredentialProvider {
  readonly #baseUrl: string;
  readonly #store: TokenStore;
  readonly #scope: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #openBrowser: (url: string) => void;
  readonly #now: () => number;
  readonly #callbackTimeoutMs: number;
  #inflightRefresh: Promise<string> | null = null;

  constructor(deps: OAuthDeps) {
    this.#baseUrl = deps.baseUrl;
    this.#store = deps.store;
    this.#scope = deps.scope;
    this.#fetch = deps.fetchImpl ?? fetch;
    this.#openBrowser = deps.openBrowser ?? defaultOpenBrowser;
    this.#now = deps.now ?? (() => Date.now());
    this.#callbackTimeoutMs = deps.callbackTimeoutMs ?? 5 * 60 * 1000;
  }

  async getCredential(): Promise<string> {
    const entry = this.#store.read(this.#baseUrl);
    if (entry.accessToken && !this.#isExpired(entry)) {
      return entry.accessToken;
    }
    if (entry.refreshToken) {
      return this.#refresh();
    }
    return this.#interactiveAuth();
  }

  async reauthorize(): Promise<boolean> {
    const entry = this.#store.read(this.#baseUrl);
    try {
      if (entry.refreshToken) {
        await this.#refresh();
      } else {
        await this.#interactiveAuth();
      }
      return true;
    } catch {
      // #refresh already cleared tokens on invalid_grant; surface the 401.
      return false;
    }
  }

  #isExpired(entry: TokenEntry): boolean {
    if (typeof entry.expiresAt !== "number") {
      return false; // unknown expiry: assume valid and rely on a 401 to recover.
    }
    return this.#now() >= entry.expiresAt - 30_000; // 30s skew.
  }

  #toEntry(t: TokenResponse): TokenEntry {
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: typeof t.expires_in === "number" ? this.#now() + t.expires_in * 1000 : undefined,
    };
  }

  #parseTokens(raw: unknown): TokenResponse {
    const t = raw as TokenResponse;
    if (!t || typeof t.access_token !== "string" || t.access_token.length === 0) {
      throw new Error("The token endpoint returned no access_token.");
    }
    return t;
  }

  // Single-flight: never fire two concurrent refreshes with the same (single-use)
  // refresh token — the server revokes the whole chain on reuse.
  #refresh(): Promise<string> {
    if (this.#inflightRefresh) {
      return this.#inflightRefresh;
    }
    const p = this.#doRefresh().finally(() => {
      this.#inflightRefresh = null;
    });
    this.#inflightRefresh = p;
    return p;
  }

  async #doRefresh(): Promise<string> {
    const entry = this.#store.read(this.#baseUrl);
    if (!entry.refreshToken || !entry.clientId) {
      throw new Error("No refresh token cached; re-authentication is required.");
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: entry.refreshToken,
      client_id: entry.clientId,
    });
    const res = await this.#fetch(`${this.#baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      let slug = "";
      try {
        slug = ((await res.json()) as { error?: string }).error ?? "";
      } catch {
        // non-JSON error body
      }
      if (slug === "invalid_grant") {
        this.#store.clearTokens(this.#baseUrl);
        throw new Error("The saved session was rejected (invalid_grant); please re-authenticate.");
      }
      throw new Error(`Token refresh failed (${res.status}).`);
    }
    const tokens = this.#parseTokens(await res.json());
    // Persist the NEW (rotated) refresh token atomically BEFORE returning it.
    this.#store.merge(this.#baseUrl, this.#toEntry(tokens));
    return tokens.access_token;
  }

  async #interactiveAuth(): Promise<string> {
    const { verifier, challenge } = generatePkce();
    const state = generateState();
    const listener = await this.#startLoopback(state);
    try {
      const redirectUri = `http://127.0.0.1:${listener.port}/callback`;
      // Register a FRESH client for this run's ephemeral loopback port. The
      // Authorization Server matches redirect_uri EXACTLY — it does not apply the
      // RFC 8252 §7.3 "any loopback port" exception — so a client_id cached from
      // an earlier run (registered against a now-stale port) would be rejected
      // here with a redirect mismatch, silently breaking re-authentication. The
      // new client_id is persisted and then reused for the (portless) refresh
      // grant until the server rejects it. Interactive auth is rare (only when
      // the refresh chain has lapsed), so the extra DCR registration is cheap.
      const clientId = await this.#register(redirectUri);
      this.#store.merge(this.#baseUrl, { clientId });
      const authUrl = this.#buildAuthorizeUrl(clientId, redirectUri, challenge, state);
      this.#openBrowser(authUrl); // the URL embeds state — never log it.
      const code = await listener.code;
      const tokens = await this.#exchangeCode(clientId, code, redirectUri, verifier);
      this.#store.merge(this.#baseUrl, { clientId, ...this.#toEntry(tokens) });
      return tokens.access_token;
    } finally {
      listener.close();
    }
  }

  async #register(redirectUri: string): Promise<string> {
    const res = await this.#fetch(`${this.#baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: `${SERVER_NAME} MCP ${VERSION}`,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none", // public client (PKCE, no secret).
        scope: this.#scope, // undefined ⇒ omitted by JSON.stringify ⇒ server default.
      }),
    });
    if (!res.ok) {
      throw new Error(`Dynamic client registration failed (${res.status}).`);
    }
    const body = (await res.json()) as { client_id?: string };
    if (!body.client_id) {
      throw new Error("Dynamic client registration returned no client_id.");
    }
    return body.client_id;
  }

  #buildAuthorizeUrl(
    clientId: string,
    redirectUri: string,
    challenge: string,
    state: string,
  ): string {
    const u = new URL(`${this.#baseUrl}/oauth/authorize`);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    // No scope param unless one was configured: the server treats an absent
    // scope as "all read scopes", and hard-fails (invalid_scope, before any
    // consent screen) on anything outside its registry.
    if (this.#scope) {
      u.searchParams.set("scope", this.#scope);
    }
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  }

  async #exchangeCode(
    clientId: string,
    code: string,
    redirectUri: string,
    verifier: string,
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    const res = await this.#fetch(`${this.#baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Token exchange failed (${res.status}).`);
    }
    return this.#parseTokens(await res.json());
  }

  // Loopback listener bound to 127.0.0.1 only, ephemeral port, single request,
  // validates state, accepts only /callback.
  #startLoopback(
    expectedState: string,
  ): Promise<{ port: number; code: Promise<string>; close: () => void }> {
    return new Promise((resolveStart, rejectStart) => {
      let resolveCode!: (c: string) => void;
      let rejectCode!: (e: Error) => void;
      const code = new Promise<string>((res, rej) => {
        resolveCode = res;
        rejectCode = rej;
      });

      const server = createServer((req, res) => {
        try {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          if (url.pathname !== "/callback") {
            res.writeHead(404, { "content-type": "text/plain" });
            res.end("Not found");
            return;
          }
          const returnedState = url.searchParams.get("state") ?? "";
          if (!statesEqual(returnedState, expectedState)) {
            res.writeHead(400, { "content-type": "text/html" });
            res.end(ERROR_HTML);
            rejectCode(new Error("OAuth state mismatch — aborting (possible CSRF)."));
            return;
          }
          const err = url.searchParams.get("error");
          if (err) {
            res.writeHead(400, { "content-type": "text/html" });
            res.end(ERROR_HTML);
            rejectCode(new Error(`Authorization was denied (${err}).`));
            return;
          }
          const authCode = url.searchParams.get("code");
          if (!authCode) {
            res.writeHead(400, { "content-type": "text/html" });
            res.end(ERROR_HTML);
            rejectCode(new Error("Authorization response had no code."));
            return;
          }
          res.writeHead(200, { "content-type": "text/html" });
          res.end(SUCCESS_HTML);
          resolveCode(authCode);
        } catch (e) {
          rejectCode(e instanceof Error ? e : new Error("Callback handling failed."));
        }
      });

      const timeout = setTimeout(() => {
        rejectCode(
          new Error(
            "Timed out waiting for browser sign-in. Ensure a browser is available on this machine, or set FF_API_KEY to use an API key instead.",
          ),
        );
      }, this.#callbackTimeoutMs);
      timeout.unref();

      const close = () => {
        clearTimeout(timeout);
        server.close();
      };

      server.on("error", (e) => rejectStart(e));
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolveStart({ port, code, close });
      });
    });
  }
}
