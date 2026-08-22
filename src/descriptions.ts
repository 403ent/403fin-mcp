// Tool descriptions, keyed by OpenAPI operationId.
//
// These are copied VERBATIM from the gateway's remote-MCP registry
// (services/gateway/internal/mcpserver/registry.go, the `desc*` constants) so
// the standalone connector describes each tool exactly as the first-party
// surface does. The three write descriptions (updateGoal, recordGoalContribution,
// switchBudgetMethod) carry mandated caveats and MUST stay byte-identical to the
// source; a conformance test pins the write set. Every string is a static
// literal — user data is never interpolated into a description.

export const descriptions: Record<string, string> = {
  listAccounts:
    "List the user's financial accounts (checking, savings, credit, loans, and more) with balances. Some accounts or fields may be hidden or omitted per the connection's privacy settings. Each account names its connection with connection_id, and names its own institution only when that differs from the connection's.",
  getAccount:
    "Get one account by id. Returns not-found if the account does not exist or is hidden by the connection's privacy settings.",
  getAccountBalances: "Get the current and available balances for one account by id.",
  listConnections:
    "List the user's linked bank/institution connections and their sync status. Institution names may be redacted per the connection's privacy settings. Each connection also names the rail its data arrives on: provider, plus source_aggregator when that provider fronts another aggregator (Finicity or MX behind Quiltt, for example).",
  getSyncStatus: "Get a summary of the sync status across all of the user's linked connections.",
  listTransactions:
    "List the user's transactions, optionally filtered by account, category, date range, pending state, or source. Merchant, description, and amount fields may be redacted, and transactions on excluded accounts or categories are omitted, per the connection's privacy settings. A transaction names only its account_id; to say which bank and which rail it came from, look up that account and then the account's connection.",
  getTransaction:
    "Get one transaction by id. Returns not-found if it does not exist or is hidden by the connection's privacy settings.",
  searchTransactions:
    "Search the user's transactions by a free-text query, optionally within a date range.",
  listCategories:
    "List the user's spending categories. Excluded categories are omitted per the connection's privacy settings.",
  listBudgets: "List the user's budgets.",
  getBudget: "Get one budget by id.",
  getBudgetProgress:
    "Get spending progress for one budget by id, optionally for a specific month (YYYY-MM). Spend on excluded accounts/categories is omitted per the connection's privacy settings.",
  listRecurring: "List the user's detected recurring transactions/subscriptions.",
  listUpcomingBills:
    "List upcoming bills due within an optional number of days ahead (default 30).",
  listGoals:
    "List the user's savings goals. Goal names may be redacted, and goals tied only to excluded accounts are omitted, per the connection's privacy settings.",
  getGoal: "Get one savings goal by id.",
  getGoalProgress: "Get the progress toward one savings goal by id.",
  getGoalHistory:
    "Get the historical balance snapshots for one savings goal by id over a date range (start_date required).",
  getGoalContributions: "List the recorded contributions to one savings goal by id.",
  getNetWorth:
    "Get the user's current net worth. Unavailable when the connection excludes any account or redacts a money field (a stored snapshot cannot be recomputed to exclude an account).",
  getNetWorthHistory:
    "Get the user's net worth over time. Unavailable when the connection excludes any account or redacts a money field.",
  listHoldings:
    "List the user's investment holdings, optionally for one account. Holding identity/value may be redacted, and holdings on excluded accounts are omitted, per the connection's privacy settings.",
  listLiabilities:
    "List the user's liabilities (loans, credit, mortgages), optionally for one account.",
  getDebtSummary:
    "Get a summary of the user's debt by currency. Liabilities on excluded accounts are omitted per the connection's privacy settings.",
  computeDebtPayoffPlan:
    "Compute a debt payoff plan (snowball, avalanche, or custom) given a monthly budget or extra payment. Read-only: it computes a plan and changes nothing.",
  insightsSpendingByCategory:
    "Get spending totals by category over a date range (start_date and end_date required). Excluded accounts/categories are omitted per the connection's privacy settings.",
  insightsIncomeVsExpenses:
    "Get income versus expenses by month over a date range (start_date and end_date required).",
  insightsMonthSummary: "Get a one-month income/expense summary for a given month (YYYY-MM).",
  insightsCashFlowForecast:
    "Forecast the user's cash flow over an optional number of days ahead (default 30), optionally for one account.",
  updateGoal:
    "Update a savings goal's editable fields (name, description, target_amount, target_date). Only these four fields can be changed; provide at least one. Requires a unique idempotency_key so a retried call does not apply the change twice.",
  recordGoalContribution:
    "Record a contribution toward a savings goal. Requires the goal id and a decimal amount; currency defaults to the goal's currency. A goal that mirrors a linked account's balance records its contributions automatically and refuses a manual one — adjust its target instead; read tracking_mode on the goal to tell which kind it is. Requires a unique idempotency_key so a retried call does not record the contribution twice.",
  switchBudgetMethod:
    "Switch the user's budgeting method. This creates a NEW budget and archives the current one. If the budget is shared, the change needs partner approval in the app and cannot be completed here. Always confirm with the user before calling, and set confirm=true only after they agree. Requires a unique idempotency_key so a retried call does not switch twice.",
  createTransaction:
    "Create a manual transaction. This records a transaction the user is telling you about; it does not import anything from a bank. account_id must name an account visible to this connection — one it cannot see is not-found, exactly like one that does not exist. date is YYYY-MM-DD and amount is a decimal string, negative for spending; the currency defaults to the account's. Requires a unique idempotency_key so a retried call does not post the same spending twice.",
  updateTransaction:
    "Update a transaction's fields. expected_version is required and must come from a prior read of this transaction; if the row changed since that read, the call conflicts and you re-read. Bank-synced rows can be edited — the bank-recorded original of each field is kept at the first edit, and revert_to_provider hands named fields back to the bank. A transaction's currency cannot be changed. Some fields may be hidden by the connection's privacy settings, and a write to a hidden field is refused. Requires a unique idempotency_key so a retried call does not apply the change twice.",
  deleteTransaction:
    "Delete a manual or imported transaction. Bank-synced transactions cannot be deleted — the bank is the source of truth for them and the next sync would recreate the row. A transaction hidden by the connection's privacy settings is not-found, exactly like one that does not exist. Requires a unique idempotency_key; the key is bound to this transaction id, so reusing it for a different transaction is a conflict rather than a silent replay.",
  annotateTransaction:
    "Set a transaction's category, tags, memo, or location — and nothing else. It never creates a merchant auto-categorization rule: categorizing one transaction here does not teach the app to categorize the user's other transactions from that merchant the same way. A split transaction is refused rather than having its slices replaced. Some of these fields may be hidden by the connection's privacy settings, and a write to a hidden field is refused. Requires a unique idempotency_key so a retried call does not annotate twice.",
  categorizeTransactions:
    "Assign categories to up to 100 transactions in one call. The outcome is per item: applied_count says how many rows were written and every item reports its own result, so a partial success is normal rather than an error. Like annotate_transaction, this never creates a merchant auto-categorization rule. To retry the items that failed, send a new batch with a FRESH idempotency_key — reusing the original key replays the original result and changes nothing.",
  createCategory:
    "Create a custom spending category. Categories nest one level, so parent_id must name a top-level category visible to this connection. The seeded system categories belong to the app and cannot be created or changed here. Requires a unique idempotency_key so a retried call does not create the category twice.",
  updateCategory:
    "Rename, re-parent, or restyle a custom category; provide at least one field. System categories — the seeded defaults the rest of the app keys on — cannot be changed. A category hidden by the connection's privacy settings is not-found, exactly like one that does not exist. Requires a unique idempotency_key so a retried call does not apply the change twice.",
  deleteCategory:
    "Delete a custom category. System categories cannot be deleted. By default the category's transactions become uncategorized; pass merge_into_category_id to reassign them to another category this connection can see instead. Requires a unique idempotency_key; the key is bound to this category id, so reusing it for a different category is a conflict rather than a silent replay.",
};
