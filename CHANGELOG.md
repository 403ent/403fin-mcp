# Changelog

All notable changes to `@403fin/mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-23

### Added

- **Eight write tools** (32 → 40 tools, 3 → 11 writes), generated from the
  gateway's write surface v2: `create_transaction`, `update_transaction`,
  `delete_transaction`, `annotate_transaction`, `categorize_transactions`,
  `create_category`, `update_category`, and `delete_category`. Each still takes
  an optional `idempotency_key` defaulting to a per-call random UUID, so a retry
  replays rather than applies twice.
- **Three new write scopes**, and the two transaction ones are deliberately
  different sizes: `transactions.annotate:write` reaches only
  `annotate_transaction` and `categorize_transactions`, so an assistant that sorts
  spending into categories can never change an amount or delete a row;
  `transactions:write` reaches all five; `categories:write` reaches the three
  category tools. README documents the scope-to-tool map.
- **`destructive` on every `ToolSpec`**, pinned by name in
  `scripts/generate-tools.ts` and asserted by the conformance test rather than
  guessed from the HTTP verb. It feeds `destructiveHint`, whose MCP default is
  *true* when omitted — so each additive write now says `false` out loud, and the
  three tools that remove or replace something the user already had
  (`delete_transaction`, `delete_category`, `switch_budget_method`) say `true`.
  This replaces the single hardcoded `switch_budget_method` check in `server.ts`.

### Changed

- The tool generator now emits **object and object-array** input schemas instead
  of collapsing them to strings. The new writes needed it: a transaction's
  `location` is a five-component object, and a bulk categorize's `items` is an
  array of `{transaction_id, category_id, expected_version?}`. Flattening either
  would have handed the model a schema its correct call could not satisfy. The 32
  pre-existing tools regenerate byte-for-byte unchanged apart from the new field.
- `record_goal_contribution`'s description now names the balance-mirror refusal:
  a goal that mirrors a linked account's balance records contributions
  automatically and rejects a manual one — adjust its target instead. Read
  `tracking_mode` on the goal to know which kind it is before calling.

- Refreshed `openapi.yaml` for the API's transaction-attribution revision. That
  drift was additive and response-side only, so it left the tool table unchanged
  (the write surface above is what grew it): accounts gained `institution_name` and
  `institution_logo_url`, populated only when an account's own bank differs from
  its connection's; connections gained `source_aggregator`, naming the
  aggregator a provider fronts (Finicity or MX behind Quiltt). A new "Where a
  transaction came from" section documents the two-hop join — transaction to
  account to connection — and records that both institution fields are hidden
  together with the connection's under the `connection.institution` privacy
  setting, while `provider` and `source_aggregator` are never redacted.
- `list_accounts`, `list_connections`, and `list_transactions` descriptions now
  tell the model how to follow that join, matching the gateway's own MCP surface
  verbatim.

### Initial build (2026-08-21, previously unreleased)

First public release — the official Model Context Protocol server for Forbidden
Finance, published to npm as `@403fin/mcp`. It is a thin stdio client over the
public `/v1` REST API: no backend, no data store, and credentials never leave the
machine it runs on.

### Added

- **32 tools** generated from the gateway's OpenAPI spec — 29 read-only and 3
  writes (`update_goal`, `record_goal_contribution`, `switch_budget_method`).
  Reads cover accounts and balances, connections and sync status, transactions
  and search, categories, budgets and progress, recurring streams and upcoming
  bills, goals with progress/history/contributions, net worth and its history,
  holdings, liabilities, debt summary and payoff planning, and spending, income
  and cash-flow insights.
- **Write safety.** A tool is a write iff its operation declares a required
  `Idempotency-Key` header, not because of its HTTP verb — so
  `compute_debt_payoff_plan`, a POST that only computes, is correctly a read.
  Every write accepts an optional `idempotency_key`, defaulting to a per-call
  random UUID, so a retry replays the original result instead of applying twice.
- **Two authentication modes.** An `ff_` API key via `FF_API_KEY`, held in memory
  only; or, when that is unset, an interactive OAuth 2.1 authorization-code flow
  with PKCE, dynamic client registration, and a one-time `127.0.0.1` loopback
  callback. OAuth tokens are cached per base URL under the OS config directory
  (`0600` file in a `0700` directory) and refreshed automatically.
- **Self-hosting** via `FF_BASE_URL`, which must be `https://`; the connector
  refuses plain HTTP and never disables TLS verification.
- `SECURITY.md` describing the security model and how to report a vulnerability.
- GitHub Actions CI running build, lint, and the test suite on Node 22.

### Changed

- Refreshed `openapi.yaml` from the gateway's canonical spec. The drift is
  additive and response-side only, so the generated tool table is unchanged:
  `display_name` on transaction, recurring, and upcoming-bill payloads;
  `period_start`, `period_end`, `period_label`, and `is_current_period` on budget
  progress; `covered_by_plan_line`; `phase_active`; and a "Names on a
  transaction" section documenting that `display_name` is the requesting user's
  own per-viewer label, never a replacement for the provider's `merchant`.

### Fixed

- **OAuth sign-in no longer requests a default scope.** Live end-to-end testing
  found the interactive flow defaulted to `offline_access`, which the
  Authorization Server — which validates every requested scope against its
  registry — rejected with `invalid_scope` before the consent screen ever
  rendered. The authorize request now carries no `scope` parameter unless
  `FF_SCOPES` is set, which is the server's documented contract for "all read
  scopes, no writes"; refresh tokens are issued either way.

[Unreleased]: https://github.com/403ent/403fin-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/403ent/403fin-mcp/releases/tag/v1.0.0
