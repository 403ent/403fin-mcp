# @403fin/mcp

The official [Model Context Protocol](https://modelcontextprotocol.io) server for
**Forbidden Finance**. It lets an MCP-capable AI assistant (Claude, ChatGPT,
Perplexity, and others) read your accounts, transactions, budgets, goals, net
worth, investments, debt, and insights — and make a few carefully-guarded
changes — through the Forbidden Finance public `/v1` API.

It is a thin, open-source client: every tool call is a single authenticated HTTPS
request to `/v1`. There is no backend code and no data store. Your credential and
OAuth tokens stay on your machine.

- **32 tools** — 29 read-only, 3 writes (`update_goal`,
  `record_goal_contribution`, `switch_budget_method`).
- **Two ways to authenticate** — an `ff_` API key, or an interactive OAuth 2.1
  sign-in (PKCE) with a local loopback callback.
- **Premium feature.** The public API is available on the Premium tier.

## Quickstart

Run it with `npx` (no install needed):

```bash
FF_API_KEY=ff_ak_your_key npx @403fin/mcp
```

The server speaks MCP over stdio, so you normally don't run it by hand — you point
your AI app at it with one of the config snippets below.

### Get an API key

In the Forbidden Finance app, go to **Settings → AI & API Connections** and create
a key. It starts with `ff_`. Keep it secret — treat it like a password.

## Configure your AI app

### Claude Desktop

Edit `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`, Windows:
`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "forbidden-finance": {
      "command": "npx",
      "args": ["-y", "@403fin/mcp"],
      "env": {
        "FF_API_KEY": "ff_ak_your_key"
      }
    }
  }
}
```

### ChatGPT (Developer Mode / MCP)

Add a **stdio** MCP server:

```json
{
  "mcpServers": {
    "forbidden-finance": {
      "command": "npx",
      "args": ["-y", "@403fin/mcp"],
      "env": { "FF_API_KEY": "ff_ak_your_key" }
    }
  }
}
```

### Perplexity

In Perplexity's MCP settings, add a local (stdio) server:

```json
{
  "mcpServers": {
    "forbidden-finance": {
      "command": "npx",
      "args": ["-y", "@403fin/mcp"],
      "env": { "FF_API_KEY": "ff_ak_your_key" }
    }
  }
}
```

## Authentication

You can authenticate two ways. The server picks based on your environment:

### 1. API key (recommended, simplest)

Set `FF_API_KEY` to your `ff_` key. That's it. The key is held in memory only and
is never written to disk or logged.

### 2. OAuth 2.1 sign-in (no API key)

If `FF_API_KEY` is **not** set, the first tool call starts an OAuth 2.1
authorization-code flow with PKCE:

1. Your browser opens to the Forbidden Finance consent screen.
2. After you approve, a one-time `127.0.0.1` loopback listener captures the
   result.
3. Access and refresh tokens are cached locally (see below) and refreshed
   automatically as needed.

No client secret is involved (the client is registered dynamically as a public
PKCE client). To force a specific scope, set `FF_SCOPES` (defaults to
`offline_access`).

**Token cache location** (keyed per base URL, file `0600` / dir `0700`):

- Linux/macOS: `$XDG_CONFIG_HOME/403fin-mcp/tokens.json` (or
  `~/.config/403fin-mcp/tokens.json`)
- Windows: `%APPDATA%\403fin-mcp\tokens.json`

## Environment variables

| Variable      | Required | Default               | Purpose                                                        |
| ------------- | -------- | --------------------- | -------------------------------------------------------------- |
| `FF_API_KEY`  | no\*     | —                     | Your `ff_` API key. When set, selects API-key auth.            |
| `FF_BASE_URL` | no       | `https://api.403fin.io` | API origin. Must be `https://`. Set this for self-hosting.   |
| `FF_SCOPES`   | no       | `offline_access`      | OAuth scope string (OAuth mode only).                          |

\* Either set `FF_API_KEY`, or leave it unset to use OAuth.

### Self-hosting

If you run your own Forbidden Finance instance, point the connector at it:

```bash
FF_BASE_URL=https://ff.your-domain.example FF_API_KEY=ff_ak_your_key npx @403fin/mcp
```

`FF_BASE_URL` must use HTTPS — the connector refuses plain HTTP and never disables
TLS verification.

## What the AI can and cannot do

- **Reads** cover accounts, balances, connections, sync status, transactions and
  search, categories, budgets and progress, recurring rules and upcoming bills,
  goals (with progress, history, and contributions), net worth and its history,
  holdings, liabilities, debt summary and payoff planning, and spending / income /
  cash-flow insights.
- **Writes** are limited to three tools and each requires an idempotency key so a
  retried call can't double-apply: update a goal's editable fields, record a goal
  contribution, and switch your budgeting method. Switching a **shared** budget
  needs partner approval in the app and cannot be completed here.

## Privacy

This connector enforces the redaction and account/category exclusion choices you
configured for the credential — hidden fields and excluded accounts are omitted or
reported as unavailable by the API, exactly as in the app. See
[`SECURITY.md`](./SECURITY.md) for the full security model.

## Development

```bash
npm install
npm run generate   # regenerate src/tools/generated.ts from openapi.yaml
npm run build      # tsc → dist/
npm test           # vitest
npm run lint       # biome check
```

The tool table (`src/tools/generated.ts`) is generated from `openapi.yaml`; a
conformance test asserts the 32 tools match the spec and that the write set is
exactly the three operations with an `Idempotency-Key`.

## License

MIT © 2026 403 Finance, Inc.
