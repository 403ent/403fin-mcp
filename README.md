# @403fin/mcp

The official [Model Context Protocol](https://modelcontextprotocol.io) server for
**Forbidden Finance**. It lets an MCP-capable AI assistant (Claude, ChatGPT,
Perplexity, and others) read your accounts, transactions, budgets, goals, net
worth, investments, debt, and insights — and make a few carefully-guarded
changes — through the Forbidden Finance public `/v1` API.

It is a thin, open-source client: every tool call is a single authenticated HTTPS
request to `/v1`. There is no backend code and no data store. Your credential and
OAuth tokens stay on your machine.

- **40 tools** — 29 read-only and 11 writes: transactions
  (`create_transaction`, `update_transaction`, `delete_transaction`,
  `annotate_transaction`, `categorize_transactions`), categories
  (`create_category`, `update_category`, `delete_category`), goals
  (`update_goal`, `record_goal_contribution`), and `switch_budget_method`.
  Writes need a connection with writes enabled and the matching `:write` scope.
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
PKCE client). No scope is requested by default, which grants all read scopes and
no writes; set `FF_SCOPES` to narrow that further. Refresh tokens are issued
either way.

To use the write tools over OAuth, two things must both be true: request the
write scopes via `FF_SCOPES` (a write scope implies its read scope), **and**
enable **Allow changes** on the consent screen. Either one alone is not enough —
writes stay off until you opt in on both.

| Scope | Reaches |
|---|---|
| `transactions.annotate:write` | `annotate_transaction`, `categorize_transactions` |
| `transactions:write` | those two **plus** `create_transaction`, `update_transaction`, `delete_transaction` |
| `categories:write` | `create_category`, `update_category`, `delete_category` |
| `goals:write` | `update_goal`, `record_goal_contribution` |
| `budgets:write` | `switch_budget_method` |

The two transaction scopes are deliberately different sizes: an assistant that
only sorts your spending into categories can be given
`transactions.annotate:write` and will never be able to change an amount or
delete a row. Example: `FF_SCOPES="transactions.annotate:write categories:write"`.

**Token cache location** (keyed per base URL, file `0600` / dir `0700`):

- Linux/macOS: `$XDG_CONFIG_HOME/403fin-mcp/tokens.json` (or
  `~/.config/403fin-mcp/tokens.json`)
- Windows: `%APPDATA%\403fin-mcp\tokens.json`

## Environment variables

| Variable      | Required | Default                 | Purpose                                                                                                              |
| ------------- | -------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `FF_API_KEY`  | no\*     | —                       | Your `ff_` API key. When set, selects API-key auth.                                                                  |
| `FF_BASE_URL` | no       | `https://api.403fin.io` | API origin. Must be `https://`. Set this for self-hosting.                                                           |
| `FF_SCOPES`   | no       | omitted                 | OAuth scope string (OAuth mode only). Omitted, the server grants all read scopes and no writes; set this to narrow.   |

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
- **Writes** are limited to eleven tools, each requiring an idempotency key so a
  retried call can't double-apply: create, edit, delete, annotate, and bulk
  categorize transactions; create, edit, and delete custom categories; update a
  goal's editable fields; record a goal contribution; and switch your budgeting
  method.
- **What writes still cannot do.** Bank-synced transactions cannot be deleted —
  the bank is the source of truth and the next sync would bring the row back.
  System categories (the seeded defaults) cannot be changed or deleted. A
  transaction's currency cannot be changed. No write ever creates a merchant
  auto-categorization rule, so an assistant sorting your spending never teaches
  the app new habits on your behalf, and no write replaces the slices of a split
  transaction. Switching a **shared** budget needs partner approval in the app
  and cannot be completed here.

## Privacy

This connector enforces the redaction and account/category exclusion choices you
configured for the credential — hidden fields and excluded accounts are omitted or
reported as unavailable by the API, exactly as in the app. See
[`SECURITY.md`](https://github.com/403ent/403fin-mcp/blob/main/SECURITY.md) for the
full security model.

## Development

```bash
npm install
npm run generate   # regenerate src/tools/generated.ts from openapi.yaml
npm run build      # tsc → dist/
npm test           # vitest
npm run lint       # biome check
```

The tool table (`src/tools/generated.ts`) is generated from `openapi.yaml`; a
conformance test asserts the 40 tools match the spec, that the write set is
exactly the eleven operations with an `Idempotency-Key`, and that the destructive
set is exactly `delete_transaction`, `delete_category`, and
`switch_budget_method`.

## License

MIT © 2026 403 Finance, Inc.
