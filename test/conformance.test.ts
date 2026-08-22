import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { descriptions } from "../src/descriptions.js";
import { tools } from "../src/tools/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// biome-ignore lint/suspicious/noExplicitAny: OpenAPI documents are dynamically shaped.
type Json = any;
const spec = parseYaml(readFileSync(resolve(repoRoot, "openapi.yaml"), "utf8")) as Json;

function resolveRef(ref: string): Json {
  const parts = ref.replace(/^#\//, "").split("/");
  let node: Json = spec;
  for (const p of parts) {
    node = node[p];
  }
  return node;
}
function deref(node: Json): Json {
  return node && typeof node === "object" && node.$ref ? resolveRef(node.$ref) : node;
}

interface SpecOp {
  operationId: string;
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  bodyParams: string[];
  hasIdempotencyKey: boolean;
}

const HTTP_METHODS = ["get", "post", "patch", "put", "delete"];

function collectOps(): SpecOp[] {
  const ops: SpecOp[] = [];
  for (const [path, item] of Object.entries<Json>(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) {
        continue;
      }
      const pathParams: string[] = [];
      const queryParams: string[] = [];
      const bodyParams: string[] = [];
      let hasIdempotencyKey = false;
      for (const raw of op.parameters ?? []) {
        const p = deref(raw);
        if (p.in === "path") {
          pathParams.push(p.name);
        } else if (p.in === "query") {
          queryParams.push(p.name);
        } else if (p.in === "header" && p.name === "Idempotency-Key" && p.required) {
          hasIdempotencyKey = true;
        }
      }
      if (op.requestBody) {
        const schema = deref(op.requestBody.content["application/json"].schema);
        for (const name of Object.keys(schema.properties ?? {})) {
          bodyParams.push(name);
        }
      }
      ops.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        pathParams,
        queryParams,
        bodyParams,
        hasIdempotencyKey,
      });
    }
  }
  return ops;
}

const specOps = collectOps();
const opById = new Map(specOps.map((o) => [o.operationId, o]));

describe("tool ↔ openapi conformance", () => {
  it("generates exactly 40 tools", () => {
    expect(tools).toHaveLength(40);
    expect(specOps).toHaveLength(40);
  });

  it("covers every operationId exactly once, no extras", () => {
    const toolOpIds = tools.map((t) => t.operationId).sort();
    const specOpIds = specOps.map((o) => o.operationId).sort();
    expect(toolOpIds).toEqual(specOpIds);
    expect(new Set(toolOpIds).size).toBe(toolOpIds.length);
  });

  it("has unique tool names", () => {
    const names = tools.map((t) => t.toolName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("matches method, path, and params for every operation", () => {
    for (const tool of tools) {
      const op = opById.get(tool.operationId);
      expect(op, `spec op for ${tool.operationId}`).toBeDefined();
      if (!op) {
        continue;
      }
      expect(tool.method, tool.toolName).toBe(op.method);
      expect(tool.path, tool.toolName).toBe(op.path);
      expect([...tool.pathParams].sort(), tool.toolName).toEqual([...op.pathParams].sort());
      expect([...tool.queryParams].sort(), tool.toolName).toEqual([...op.queryParams].sort());
      expect([...tool.bodyParams].sort(), tool.toolName).toEqual([...op.bodyParams].sort());
    }
  });

  it("input shape keys = path ∪ query ∪ body (+ idempotency_key for writes)", () => {
    for (const tool of tools) {
      const expected = new Set([...tool.pathParams, ...tool.queryParams, ...tool.bodyParams]);
      if (tool.isWrite) {
        expected.add("idempotency_key");
      }
      expect(new Set(Object.keys(tool.inputShape)), tool.toolName).toEqual(expected);
    }
  });

  it("isWrite is driven by the Idempotency-Key header, not the HTTP verb", () => {
    for (const tool of tools) {
      const op = opById.get(tool.operationId);
      expect(tool.isWrite, tool.toolName).toBe(op?.hasIdempotencyKey);
    }
    // computeDebtPayoffPlan is POST but a READ (no Idempotency-Key).
    const payoff = tools.find((t) => t.operationId === "computeDebtPayoffPlan");
    expect(payoff?.method).toBe("POST");
    expect(payoff?.isWrite).toBe(false);
  });

  it("the write set is exactly the eleven idempotent writes", () => {
    const writes = tools
      .filter((t) => t.isWrite)
      .map((t) => t.toolName)
      .sort();
    expect(writes).toEqual([
      "annotate_transaction",
      "categorize_transactions",
      "create_category",
      "create_transaction",
      "delete_category",
      "delete_transaction",
      "record_goal_contribution",
      "switch_budget_method",
      "update_category",
      "update_goal",
      "update_transaction",
    ]);
  });

  // destructiveHint defaults to TRUE when a tool omits it, so this pin is what
  // stops an additive write from advertising itself as destructive — and stops a
  // destructive one from quietly going unmarked. The set mirrors the gateway's
  // own destructiveTools map; the two surfaces must agree about which calls a
  // client should put behind a confirmation.
  it("the destructive set is exactly the three removing writes", () => {
    const destructive = tools
      .filter((t) => t.destructive)
      .map((t) => t.toolName)
      .sort();
    expect(destructive).toEqual(["delete_category", "delete_transaction", "switch_budget_method"]);
  });

  it("no read is marked destructive", () => {
    for (const tool of tools) {
      if (!tool.isWrite) {
        expect(tool.destructive, tool.toolName).toBe(false);
      }
    }
  });

  it("every description is the verbatim string keyed by operationId", () => {
    for (const tool of tools) {
      expect(tool.description, tool.toolName).toBe(descriptions[tool.operationId]);
      expect(tool.description.length, tool.toolName).toBeGreaterThan(0);
    }
  });
});
