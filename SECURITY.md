# Security

`@403fin/mcp` is a thin, local, stdio MCP client for the Forbidden Finance public
`/v1` API. It holds credentials and talks to your account, so it is built to a
strict security bar. This document records the guarantees and where they live in
the code.

## Reporting

Email **security@403fin.io** for any vulnerability. Please do not open a public
issue for security reports.

## Credentials & secrets

- **Two auth modes.** An `ff_` API key (`FF_API_KEY`) is used when set; otherwise
  the interactive OAuth 2.1 flow runs. Selection: `src/auth/select.ts`.
- **Secrets are never logged.** Tokens, the API key, the PKCE verifier, the
  authorization code, and the OAuth `state` are never written to stdout or stderr,
  and never appear in any diagnostic. stdout is the MCP transport; only non-secret
  diagnostics go to stderr. The `Authorization` header is added only at send time
  (`src/client.ts` `send()`), never stored on the request "plan" object.
- **The API key stays in memory.** `ApiKeyProvider` (`src/auth/apikey.ts`) holds
  the key in a private field and never persists it. It requires the `ff_` prefix.

## OAuth 2.1 (authorization code + PKCE)

- **All randomness comes from `node:crypto`** (`randomBytes`, `randomUUID`,
  `createHash`). `Math.random` is never used for anything security-relevant.
- **PKCE is S256.** The verifier is 32 random bytes, base64url-encoded; the
  challenge is `base64url(sha256(verifier))`; `code_challenge_method=S256`.
  See `generatePkce()` in `src/auth/oauth.ts`.
- **`state` is enforced.** A random 32-byte `state` is generated per flow and
  compared with a constant-time check (`timingSafeEqual`) on the callback; a
  mismatch aborts the flow (treated as possible CSRF).
- **Loopback redirect is locked down.** The callback listener binds to
  `127.0.0.1` only (never `0.0.0.0`), on an ephemeral port, serves a single
  request, and rejects any path other than `/callback` with a 404. It is closed
  as soon as the code is captured or the flow ends.
- **The authorize URL is never logged.** Because it embeds `state`, the browser is
  opened via the OS opener without printing the URL. On a headless machine where
  no browser can open, the flow times out with guidance to set `FF_API_KEY`
  instead — the URL (and its `state`) is still never emitted.
- **Public client via DCR.** Dynamic client registration
  (`POST /oauth/register`) registers a public client
  (`token_endpoint_auth_method: "none"`) — no client secret is used or stored.

## Token cache

- **Location.** OS per-user config dir: `$XDG_CONFIG_HOME/403fin-mcp` (or
  `~/.config/403fin-mcp`) on Linux/macOS, `%APPDATA%\403fin-mcp` on Windows.
  Keyed per `FF_BASE_URL`, so self-hosted and production tokens never mix.
- **Permissions.** The cache file is `0600` and its directory is `0700`
  (best-effort on platforms without POSIX modes).
- **Atomic writes.** Every write goes to a uniquely-named temp file and is then
  `rename()`d into place, so a crash mid-write cannot corrupt the cache or lose a
  rotated refresh token. See `TokenStore` in `src/auth/tokenstore.ts`.

## Single-use refresh-token rotation

The server rotates refresh tokens single-use and **revokes the whole connection
if a refresh token is reused.** To make that safe:

- **Single-flight refresh.** Concurrent refreshes are serialized behind one
  in-flight promise (`#refresh`/`#inflightRefresh` in `src/auth/oauth.ts`), so two
  simultaneous 401s trigger exactly one refresh call — never two with the same
  token. This is covered by a test (two concurrent `reauthorize()` → one token
  request).
- **Persist-before-use.** On a successful refresh the new access **and** refresh
  token are written atomically to the cache before the new access token is
  returned.
- **`invalid_grant` recovery.** If a refresh is rejected with `invalid_grant`, the
  cached tokens are cleared (the client id is kept) and the user is told to
  re-authenticate.

## Transport

- **HTTPS is required.** `FF_BASE_URL` must be `https://`; `http://` and other
  schemes are rejected at config load (`normalizeBaseUrl`). TLS verification is
  never disabled.
- **401 handling.** A 401 triggers at most one `reauthorize()` + retry, so a bad
  credential cannot spin.

## Supply chain

- **Minimal runtime dependencies:** only `@modelcontextprotocol/sdk` and `zod`.
  Everything else (`typescript`, `vitest`, `@biomejs/biome`, `tsx`, `yaml`) is a
  dev dependency.
- **No `postinstall`/lifecycle scripts** are declared by this package.
- A `package-lock.json` pins the full dependency tree.

### Known advisory

`npm audit` reports a moderate advisory (GHSA-frvp-7c67-39w9) in
`@hono/node-server`, a transitive dependency of `@modelcontextprotocol/sdk`'s
**HTTP** server transport. This connector uses only the **stdio** transport, so
that code path is never loaded and the advisory is not reachable here. The only
`npm audit fix` is a breaking SDK downgrade, so it is intentionally not applied;
it will clear when the SDK bumps its dependency.
