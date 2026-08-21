# Changelog

All notable changes to `@403fin/mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-08-21

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

[Unreleased]: https://github.com/403ent/403fin-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/403ent/403fin-mcp/releases/tag/v1.0.0
