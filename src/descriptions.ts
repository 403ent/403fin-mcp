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
    "List the user's financial accounts (checking, savings, credit, loans, and more) with balances. Some accounts or fields may be hidden or omitted per the connection's privacy settings.",
  getAccount:
    "Get one account by id. Returns not-found if the account does not exist or is hidden by the connection's privacy settings.",
  getAccountBalances: "Get the current and available balances for one account by id.",
  listConnections:
    "List the user's linked bank/institution connections and their sync status. Institution names may be redacted per the connection's privacy settings.",
  getSyncStatus: "Get a summary of the sync status across all of the user's linked connections.",
  listTransactions:
    "List the user's transactions, optionally filtered by account, category, date range, pending state, or source. Merchant, description, and amount fields may be redacted, and transactions on excluded accounts or categories are omitted, per the connection's privacy settings.",
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
    "Record a contribution toward a savings goal. Requires the goal id and a decimal amount; currency defaults to the goal's currency. Requires a unique idempotency_key so a retried call does not record the contribution twice.",
  switchBudgetMethod:
    "Switch the user's budgeting method. This creates a NEW budget and archives the current one. If the budget is shared, the change needs partner approval in the app and cannot be completed here. Always confirm with the user before calling, and set confirm=true only after they agree. Requires a unique idempotency_key so a retried call does not switch twice.",
};
