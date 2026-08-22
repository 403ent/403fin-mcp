#!/usr/bin/env tsx
// Code generator: reads the committed openapi.yaml and emits src/tools/generated.ts,
// one ToolSpec per /v1 operation (40 total). Run with `npm run generate`.
//
// The endpoint map, path/query params, request-body fields, and per-field zod
// schemas are all derived from the spec. Descriptions are overlaid by operationId
// from src/descriptions.ts. The write discriminator is NOT the HTTP verb: a tool
// isWrite iff its operation declares a required `Idempotency-Key` header parameter
// (so computeDebtPayoffPlan, a POST, is correctly a READ).
//
// `destructive` is NOT derivable from the spec — "does this remove something the
// user already had" is a product judgement — so DESTRUCTIVE_TOOLS below pins it,
// mirroring the gateway's own destructiveTools map in mcpserver/registry.go.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// operationId -> MCP tool name (snake_case). Sourced verbatim from the gateway's
// mcpserver/registry.go tool constants + opFor map. NOT mechanically derivable
// (e.g. getGoalContributions -> list_goal_contributions,
// insightsSpendingByCategory -> get_spending_by_category), so it is pinned here.
const OPERATION_TO_TOOL: Record<string, string> = {
  listAccounts: "list_accounts",
  getAccount: "get_account",
  getAccountBalances: "get_account_balances",
  listConnections: "list_connections",
  getSyncStatus: "get_sync_status",
  listTransactions: "list_transactions",
  searchTransactions: "search_transactions",
  getTransaction: "get_transaction",
  listCategories: "list_categories",
  listBudgets: "list_budgets",
  getBudget: "get_budget",
  getBudgetProgress: "get_budget_progress",
  switchBudgetMethod: "switch_budget_method",
  listRecurring: "list_recurring",
  listUpcomingBills: "list_upcoming_bills",
  listGoals: "list_goals",
  getGoal: "get_goal",
  updateGoal: "update_goal",
  getGoalProgress: "get_goal_progress",
  getGoalHistory: "get_goal_history",
  getGoalContributions: "list_goal_contributions",
  recordGoalContribution: "record_goal_contribution",
  getNetWorth: "get_net_worth",
  getNetWorthHistory: "get_net_worth_history",
  listHoldings: "list_holdings",
  listLiabilities: "list_liabilities",
  getDebtSummary: "get_debt_summary",
  computeDebtPayoffPlan: "compute_debt_payoff_plan",
  insightsSpendingByCategory: "get_spending_by_category",
  insightsIncomeVsExpenses: "get_income_vs_expenses",
  insightsMonthSummary: "get_month_summary",
  insightsCashFlowForecast: "get_cash_flow_forecast",
  createTransaction: "create_transaction",
  updateTransaction: "update_transaction",
  deleteTransaction: "delete_transaction",
  annotateTransaction: "annotate_transaction",
  categorizeTransactions: "categorize_transactions",
  createCategory: "create_category",
  updateCategory: "update_category",
  deleteCategory: "delete_category",
};

// Tools whose call REMOVES or REPLACES something the user already had. A client
// that gates destructive tools behind a confirmation should gate exactly these;
// every other write is additive or an in-place field edit. Pinned by hand and
// byte-for-byte the gateway's destructiveTools set — the MCP annotation defaults
// destructiveHint to TRUE when absent, so an additive tool has to say false out
// loud or it would advertise itself as destructive.
const DESTRUCTIVE_TOOLS = new Set<string>([
  "switch_budget_method",
  "delete_transaction",
  "delete_category",
]);

// biome-ignore lint/suspicious/noExplicitAny: OpenAPI documents are dynamically shaped.
type Json = any;

interface Spec {
  paths: Record<string, Record<string, Json>>;
  components: { parameters?: Record<string, Json>; schemas?: Record<string, Json> };
}

const spec = parseYaml(readFileSync(resolve(repoRoot, "openapi.yaml"), "utf8")) as Spec;

function resolveRef(ref: string): Json {
  // e.g. "#/components/parameters/Cursor" or "#/components/schemas/Goal"
  const parts = ref.replace(/^#\//, "").split("/");
  let node: Json = spec;
  for (const p of parts) {
    node = node[p];
    if (node === undefined) {
      throw new Error(`unresolved $ref: ${ref}`);
    }
  }
  return node;
}

function deref(node: Json): Json {
  return node && typeof node === "object" && "$ref" in node ? resolveRef(node.$ref) : node;
}

const HTTP_METHODS = ["get", "post", "patch", "put", "delete"] as const;

// A single input field expressed as zod source code.
interface Field {
  name: string;
  zod: string;
}

// Emit zod source for one OpenAPI schema. Recursive: the write surface introduced
// object-typed inputs (a transaction's `location`) and arrays of objects (a bulk
// categorize's `items`), and flattening either to a string would hand the model a
// schema its correct call cannot satisfy.
function zodFor(schema: Json, required: boolean, description?: string): string {
  let base: string;
  if (Array.isArray(schema.enum)) {
    base = `z.enum([${schema.enum.map((e: string) => JSON.stringify(e)).join(", ")}])`;
  } else if (schema.type === "string") {
    base = schema.format === "uuid" ? "z.string().uuid()" : "z.string()";
  } else if (schema.type === "integer") {
    base = "z.number().int()";
    if (typeof schema.minimum === "number") {
      base += `.min(${schema.minimum})`;
    }
  } else if (schema.type === "number") {
    base = "z.number()";
  } else if (schema.type === "boolean") {
    base = "z.boolean()";
  } else if (schema.type === "array") {
    base = `z.array(${zodFor(deref(schema.items ?? {}), true)})`;
  } else if (schema.type === "object" || schema.properties) {
    const req: string[] = schema.required ?? [];
    const props = Object.entries(schema.properties ?? {})
      .map(([name, raw]) => `${name}: ${zodFor(deref(raw), req.includes(name))}`)
      .join(", ");
    base = `z.object({ ${props} })`;
  } else {
    base = "z.unknown()";
  }
  const desc = description ?? schema.description;
  if (desc) {
    base += `.describe(${JSON.stringify(desc)})`;
  }
  if (!required) {
    base += ".optional()";
  }
  return base;
}

interface GeneratedTool {
  toolName: string;
  operationId: string;
  method: string;
  path: string;
  isWrite: boolean;
  destructive: boolean;
  pathParams: string[];
  queryParams: string[];
  bodyParams: string[];
  fields: Field[];
}

const generated: GeneratedTool[] = [];

for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const method of HTTP_METHODS) {
    const op = pathItem[method];
    if (!op) {
      continue;
    }
    const operationId: string = op.operationId;
    const toolName = OPERATION_TO_TOOL[operationId];
    if (!toolName) {
      throw new Error(`no tool mapping for operationId ${operationId} (${method} ${path})`);
    }

    const pathParams: string[] = [];
    const queryParams: string[] = [];
    const bodyParams: string[] = [];
    const fields: Field[] = [];
    let isWrite = false;

    for (const rawParam of op.parameters ?? []) {
      const param = deref(rawParam);
      if (param.in === "header") {
        // The only header input in this spec is Idempotency-Key, which marks a
        // write. It is sent by the client, not surfaced as a normal input field.
        if (param.name === "Idempotency-Key" && param.required) {
          isWrite = true;
        }
        continue;
      }
      const schema = deref(param.schema ?? {});
      const field: Field = {
        name: param.name,
        zod: zodFor(schema, param.required === true, param.description),
      };
      fields.push(field);
      if (param.in === "path") {
        pathParams.push(param.name);
      } else if (param.in === "query") {
        queryParams.push(param.name);
      }
    }

    // Flatten a JSON request body into individual input fields.
    if (op.requestBody) {
      const bodySchema = deref(op.requestBody.content["application/json"].schema);
      const requiredList: string[] = bodySchema.required ?? [];
      for (const [propName, rawProp] of Object.entries(bodySchema.properties ?? {})) {
        const prop = deref(rawProp);
        bodyParams.push(propName);
        fields.push({
          name: propName,
          zod: zodFor(prop, requiredList.includes(propName), prop.description),
        });
      }
    }

    // Writes take an optional idempotency_key. server.ts defaults it to a random
    // UUID so the required Idempotency-Key header is always present.
    if (isWrite) {
      fields.push({
        name: "idempotency_key",
        zod: `z.string().min(1).max(128).optional().describe("Optional idempotency key (1-128 chars) that makes this write safe to retry: a repeated call with the same key replays the original result. If omitted, a random one is generated for this call.")`,
      });
    }

    if (!isWrite && DESTRUCTIVE_TOOLS.has(toolName)) {
      throw new Error(`${toolName} is pinned destructive but is not a write`);
    }

    generated.push({
      toolName,
      operationId,
      method: method.toUpperCase(),
      path,
      isWrite,
      destructive: DESTRUCTIVE_TOOLS.has(toolName),
      pathParams,
      queryParams,
      bodyParams,
      fields,
    });
  }
}

// Stable order: by tool name, for a deterministic diff.
generated.sort((a, b) => a.toolName.localeCompare(b.toolName));

function emitTool(t: GeneratedTool): string {
  const shape = t.fields.map((f) => `      ${f.name}: ${f.zod},`).join("\n");
  return `  {
    toolName: ${JSON.stringify(t.toolName)},
    operationId: ${JSON.stringify(t.operationId)},
    method: ${JSON.stringify(t.method)},
    path: ${JSON.stringify(t.path)},
    isWrite: ${t.isWrite},
    destructive: ${t.destructive},
    pathParams: ${JSON.stringify(t.pathParams)},
    queryParams: ${JSON.stringify(t.queryParams)},
    bodyParams: ${JSON.stringify(t.bodyParams)},
    description: descriptions.${t.operationId},
    inputShape: {
${shape}
    },
  },`;
}

const writeNames = generated.filter((t) => t.isWrite).map((t) => t.toolName);
const destructiveNames = generated.filter((t) => t.destructive).map((t) => t.toolName);

const header = `// AUTO-GENERATED by scripts/generate-tools.ts from openapi.yaml. DO NOT EDIT.
//
// Run \`npm run generate\` to regenerate. ${generated.length} tools. The write set is
// exactly the ${writeNames.length} operations that declare a required Idempotency-Key header
// (${writeNames.join(", ")}).
// Of those, ${destructiveNames.join(", ")} are
// marked destructive: they remove or replace something the user already had.

import { z } from "zod";
import { descriptions } from "../descriptions.js";
import type { ToolSpec } from "./types.js";

export const tools: ToolSpec[] = [
${generated.map(emitTool).join("\n")}
];
`;

const outPath = resolve(repoRoot, "src/tools/generated.ts");
writeFileSync(outPath, header);
console.error(
  `generated ${generated.length} tools -> ${outPath} (writes: ${generated
    .filter((t) => t.isWrite)
    .map((t) => t.toolName)
    .join(", ")})`,
);
