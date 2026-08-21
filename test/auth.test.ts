import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeyProvider } from "../src/auth/apikey.js";
import {
  base64url,
  generatePkce,
  generateState,
  OAuthProvider,
  statesEqual,
} from "../src/auth/oauth.js";
import { createCredentialProvider } from "../src/auth/select.js";
import { TokenStore } from "../src/auth/tokenstore.js";
import type { Config } from "../src/config.js";

function tmpCacheFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "403fin-mcp-test-"));
  return join(dir, "nested", "tokens.json");
}

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: "https://api.403fin.io",
    cacheDir: "/tmp/x",
    cacheFile: tmpCacheFile(),
    ...overrides,
  };
}

describe("ApiKeyProvider", () => {
  it("rejects a key without the ff_ prefix", () => {
    expect(() => new ApiKeyProvider("nope")).toThrow(/ff_/);
  });

  it("returns the key and cannot recover from a 401", async () => {
    const p = new ApiKeyProvider("ff_ak_live");
    expect(await p.getCredential()).toBe("ff_ak_live");
    expect(await p.reauthorize()).toBe(false);
  });
});

describe("createCredentialProvider (auth selection)", () => {
  it("chooses the API-key provider when FF_API_KEY is present", () => {
    const p = createCredentialProvider(baseConfig({ apiKey: "ff_ak_x" }), {});
    expect(p).toBeInstanceOf(ApiKeyProvider);
  });

  it("chooses OAuth when no API key is set", () => {
    const p = createCredentialProvider(baseConfig(), {});
    expect(p).toBeInstanceOf(OAuthProvider);
  });
});

describe("PKCE + state", () => {
  it("base64url has no +, /, or = padding", () => {
    const s = base64url(Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb]));
    expect(s).not.toMatch(/[+/=]/);
  });

  it("verifier is 32 random bytes and challenge = base64url(sha256(verifier)) [S256]", () => {
    const { verifier, challenge } = generatePkce();
    // 32 bytes → 43 base64url chars.
    expect(verifier).toHaveLength(43);
    expect(verifier).not.toMatch(/[+/=]/);
    const expected = base64url(createHash("sha256").update(verifier).digest());
    expect(challenge).toBe(expected);
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it("two verifiers differ (randomness)", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });

  it("state is url-safe, random, and compared in constant time", () => {
    const a = generateState();
    expect(a).not.toMatch(/[+/=]/);
    expect(a).not.toBe(generateState());
    expect(statesEqual(a, a)).toBe(true);
    expect(statesEqual(a, `${a}x`)).toBe(false);
    expect(statesEqual("abc", "abd")).toBe(false);
  });
});

describe("TokenStore", () => {
  it("round-trips an entry and keeps 0600 file / 0700 dir perms", () => {
    const file = tmpCacheFile();
    const store = new TokenStore(file);
    store.merge("https://api.403fin.io", {
      clientId: "client-1",
      accessToken: "ff_at_1",
      refreshToken: "ff_rt_1",
      expiresAt: 123,
    });
    const read = store.read("https://api.403fin.io");
    expect(read).toEqual({
      clientId: "client-1",
      accessToken: "ff_at_1",
      refreshToken: "ff_rt_1",
      expiresAt: 123,
    });
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(join(file, "..")).mode & 0o777).toBe(0o700);
    }
  });

  it("merges without clobbering other base URLs and clears tokens but keeps clientId", () => {
    const store = new TokenStore(tmpCacheFile());
    store.merge("https://a.example", { clientId: "ca", accessToken: "ta" });
    store.merge("https://b.example", { clientId: "cb", accessToken: "tb" });
    store.merge("https://a.example", { accessToken: "ta2" });
    expect(store.read("https://a.example")).toEqual({ clientId: "ca", accessToken: "ta2" });
    expect(store.read("https://b.example")).toEqual({ clientId: "cb", accessToken: "tb" });
    store.clearTokens("https://a.example");
    expect(store.read("https://a.example")).toEqual({ clientId: "ca" });
  });

  it("leaves no temp files behind (atomic write)", async () => {
    const file = tmpCacheFile();
    const store = new TokenStore(file);
    store.merge("https://api.403fin.io", { accessToken: "x" });
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(join(file, ".."));
    expect(entries.filter((e) => e.includes(".tmp-"))).toHaveLength(0);
    expect(entries).toContain("tokens.json");
  });
});

describe("OAuthProvider single-flight refresh", () => {
  afterEach(() => vi.restoreAllMocks());

  it("serializes two concurrent 401-driven refreshes into ONE token call and persists the rotated token", async () => {
    const file = tmpCacheFile();
    const store = new TokenStore(file);
    const baseUrl = "https://api.403fin.io";
    store.merge(baseUrl, { clientId: "c-1", refreshToken: "ff_rt_old" });

    let tokenCalls = 0;
    let counter = 0;
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit) => {
      expect(url).toBe(`${baseUrl}/oauth/token`);
      tokenCalls += 1;
      // Delay so both concurrent refreshes overlap in flight.
      await new Promise((r) => setTimeout(r, 25));
      counter += 1;
      return new Response(
        JSON.stringify({
          access_token: `ff_at_new_${counter}`,
          refresh_token: `ff_rt_new_${counter}`,
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const provider = new OAuthProvider({
      baseUrl,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [a, b] = await Promise.all([provider.reauthorize(), provider.reauthorize()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(tokenCalls).toBe(1); // single-flight: exactly one refresh hit the server.

    const entry = store.read(baseUrl);
    expect(entry.accessToken).toBe("ff_at_new_1");
    expect(entry.refreshToken).toBe("ff_rt_new_1"); // rotated token persisted.
  });

  it("clears cached tokens and reports failure on invalid_grant", async () => {
    const store = new TokenStore(tmpCacheFile());
    const baseUrl = "https://api.403fin.io";
    store.merge(baseUrl, { clientId: "c-1", refreshToken: "ff_rt_dead", accessToken: "ff_at_x" });
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    const provider = new OAuthProvider({
      baseUrl,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await provider.reauthorize()).toBe(false);
    const entry = store.read(baseUrl);
    expect(entry.refreshToken).toBeUndefined();
    expect(entry.accessToken).toBeUndefined();
    expect(entry.clientId).toBe("c-1"); // client id survives.
  });

  it("uses a cached, unexpired access token without any network call", async () => {
    const store = new TokenStore(tmpCacheFile());
    const baseUrl = "https://api.403fin.io";
    store.merge(baseUrl, {
      clientId: "c-1",
      accessToken: "ff_at_valid",
      refreshToken: "ff_rt_1",
      expiresAt: Date.now() + 3_600_000,
    });
    const fetchImpl = vi.fn();
    const provider = new OAuthProvider({
      baseUrl,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await provider.getCredential()).toBe("ff_at_valid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes automatically when the cached access token is expired", async () => {
    const store = new TokenStore(tmpCacheFile());
    const baseUrl = "https://api.403fin.io";
    store.merge(baseUrl, {
      clientId: "c-1",
      accessToken: "ff_at_old",
      refreshToken: "ff_rt_1",
      expiresAt: Date.now() - 1000,
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "ff_at_fresh",
            refresh_token: "ff_rt_2",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const provider = new OAuthProvider({
      baseUrl,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await provider.getCredential()).toBe("ff_at_fresh");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("OAuthProvider interactive auth (loopback + DCR)", () => {
  afterEach(() => vi.restoreAllMocks());

  // Build an injected fetch that answers DCR + token, recording register bodies,
  // plus an openBrowser that plays the user: it visits the authorize URL's
  // loopback redirect_uri with the matching state and a fake code.
  function interactiveHarness(baseUrl: string, clientId: string) {
    const registerBodies: Array<{ redirect_uris: string[]; scope?: string }> = [];
    const authorizeUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url === `${baseUrl}/oauth/register`) {
        registerBodies.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ client_id: clientId }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === `${baseUrl}/oauth/token`) {
        return new Response(
          JSON.stringify({
            access_token: "ff_at_int",
            refresh_token: "ff_rt_int",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url ${url}`);
    });
    const openBrowser = (authUrl: string) => {
      authorizeUrls.push(authUrl);
      const u = new URL(authUrl);
      const state = u.searchParams.get("state") ?? "";
      const cb = new URL(u.searchParams.get("redirect_uri") ?? "");
      cb.searchParams.set("code", "auth-code-xyz");
      cb.searchParams.set("state", state);
      // Real GET to the real loopback server (not the injected fetch).
      void fetch(cb.toString()).catch(() => {});
    };
    return { registerBodies, authorizeUrls, fetchImpl, openBrowser };
  }

  it("runs the full loopback flow: registers a client for the current port and stores tokens", async () => {
    const store = new TokenStore(tmpCacheFile());
    const baseUrl = "https://api.403fin.io";
    const { registerBodies, fetchImpl, openBrowser } = interactiveHarness(baseUrl, "dyn-client-1");

    const provider = new OAuthProvider({
      baseUrl,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      openBrowser,
    });

    expect(await provider.getCredential()).toBe("ff_at_int");
    expect(registerBodies).toHaveLength(1);
    // The registered redirect_uri is the very loopback the browser was sent to.
    expect(registerBodies[0].redirect_uris[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const entry = store.read(baseUrl);
    expect(entry.clientId).toBe("dyn-client-1");
    expect(entry.accessToken).toBe("ff_at_int");
    expect(entry.refreshToken).toBe("ff_rt_int");
  });

  it("re-registers on re-auth instead of reusing a stale clientId (exact redirect_uri match)", async () => {
    const store = new TokenStore(tmpCacheFile());
    const baseUrl = "https://api.403fin.io";
    // A prior run left a clientId (registered against a now-gone port) but the
    // token chain has lapsed — getCredential must fall through to interactive auth.
    store.merge(baseUrl, { clientId: "stale-client-old-port" });
    const { registerBodies, fetchImpl, openBrowser } = interactiveHarness(baseUrl, "dyn-client-2");

    const provider = new OAuthProvider({
      baseUrl,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      openBrowser,
    });

    expect(await provider.getCredential()).toBe("ff_at_int");
    // It registered a fresh client for the new port rather than reusing the stale one.
    expect(registerBodies).toHaveLength(1);
    expect(store.read(baseUrl).clientId).toBe("dyn-client-2");
  });

  // The Authorization Server validates requested scopes against its registry and
  // hard-fails unknown ones with invalid_scope before any consent screen. An
  // absent scope is its documented "all read scopes, no writes" default, so the
  // unconfigured flow must send no scope at all — not offline_access, not "".
  it("sends NO scope parameter by default (server default = all read scopes)", async () => {
    const store = new TokenStore(tmpCacheFile());
    const baseUrl = "https://api.403fin.io";
    const { registerBodies, authorizeUrls, fetchImpl, openBrowser } = interactiveHarness(
      baseUrl,
      "dyn-client-3",
    );

    const provider = new OAuthProvider({
      baseUrl,
      store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      openBrowser,
    });

    expect(await provider.getCredential()).toBe("ff_at_int");
    expect(authorizeUrls).toHaveLength(1);
    const params = new URL(authorizeUrls[0]).searchParams;
    expect(params.has("scope")).toBe(false);
    // The rest of the authorize request is unchanged.
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("dyn-client-3");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBeTruthy();
    // Dynamic client registration likewise omits the key entirely.
    expect(registerBodies[0]).not.toHaveProperty("scope");
  });

  it("passes a configured scope (FF_SCOPES) through verbatim", async () => {
    const store = new TokenStore(tmpCacheFile());
    const baseUrl = "https://api.403fin.io";
    const { registerBodies, authorizeUrls, fetchImpl, openBrowser } = interactiveHarness(
      baseUrl,
      "dyn-client-4",
    );
    // Exactly what select.ts hands over from env.FF_SCOPES.
    const scope = "accounts:read transactions:read goals:write";

    const provider = new OAuthProvider({
      baseUrl,
      store,
      scope,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      openBrowser,
    });

    expect(await provider.getCredential()).toBe("ff_at_int");
    expect(new URL(authorizeUrls[0]).searchParams.get("scope")).toBe(scope);
    expect(registerBodies[0].scope).toBe(scope);
  });
});

// A tiny sanity check that randomUUID is available (used to default idempotency keys).
describe("crypto", () => {
  it("randomUUID is a v4 UUID", () => {
    expect(randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
