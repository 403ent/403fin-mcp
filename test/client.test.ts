import { describe, expect, it, vi } from "vitest";
import type { CredentialProvider } from "../src/auth/types.js";
import { type ClientContext, executeTool, mapResponse, planRequest } from "../src/client.js";
import { toolByName } from "../src/tools/index.js";
import type { ToolSpec } from "../src/tools/types.js";

const BASE = "https://api.403fin.io";

function spec(name: string): ToolSpec {
  const t = toolByName(name);
  if (!t) {
    throw new Error(`no such tool: ${name}`);
  }
  return t;
}

function staticCreds(token = "ff_ak_test"): CredentialProvider {
  return {
    getCredential: () => Promise.resolve(token),
    reauthorize: () => Promise.resolve(false),
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function problemResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

describe("planRequest", () => {
  it("interpolates path params and appends query params (read)", () => {
    const plan = planRequest(
      spec("get_goal_history"),
      { id: "g-1", start_date: "2026-01-01", end_date: "2026-06-30", resolution: "monthly" },
      BASE,
    );
    expect(plan.method).toBe("GET");
    const url = new URL(plan.url);
    expect(url.pathname).toBe("/v1/goals/g-1/history");
    expect(url.searchParams.get("start_date")).toBe("2026-01-01");
    expect(url.searchParams.get("end_date")).toBe("2026-06-30");
    expect(url.searchParams.get("resolution")).toBe("monthly");
    expect(plan.body).toBeUndefined();
    expect(plan.headers["idempotency-key"]).toBeUndefined();
  });

  it("stringifies boolean and numeric query params, drops absent ones", () => {
    const plan = planRequest(
      spec("list_transactions"),
      { page_size: 50, pending: false, account_id: undefined },
      BASE,
    );
    const url = new URL(plan.url);
    expect(url.searchParams.get("page_size")).toBe("50");
    expect(url.searchParams.get("pending")).toBe("false");
    expect(url.searchParams.has("account_id")).toBe(false);
  });

  it("builds a JSON body from body params only and sets Idempotency-Key (write)", () => {
    const plan = planRequest(
      spec("update_goal"),
      { id: "g-9", name: "Trip", target_amount: "5000.00", idempotency_key: "abc" },
      BASE,
      "abc",
    );
    expect(plan.method).toBe("PATCH");
    expect(new URL(plan.url).pathname).toBe("/v1/goals/g-9");
    const body = JSON.parse(plan.body ?? "{}");
    expect(body).toEqual({ name: "Trip", target_amount: "5000.00" });
    // id (path) and idempotency_key (header) never leak into the body.
    expect(body.id).toBeUndefined();
    expect(body.idempotency_key).toBeUndefined();
    expect(plan.headers["idempotency-key"]).toBe("abc");
    expect(plan.headers["content-type"]).toBe("application/json");
  });

  it("does NOT set Idempotency-Key for a POST that is a read (compute_debt_payoff_plan)", () => {
    const plan = planRequest(
      spec("compute_debt_payoff_plan"),
      { strategy: "avalanche", total_monthly_budget: "1200.00" },
      BASE,
      "should-be-ignored",
    );
    expect(plan.method).toBe("POST");
    expect(plan.headers["idempotency-key"]).toBeUndefined();
    expect(JSON.parse(plan.body ?? "{}")).toEqual({
      strategy: "avalanche",
      total_monthly_budget: "1200.00",
    });
  });
});

describe("mapResponse", () => {
  it("maps a 2xx envelope to structuredContent and passes money decimal strings through untouched", async () => {
    const env = {
      data: {
        id: "a-1",
        balance: { amount: "1234.56", currency: "USD" },
        available_balance: { amount: "1000.00", currency: "USD" },
      },
      redacted_fields: [],
      filtered: false,
    };
    const result = await mapResponse(jsonResponse(env));
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as typeof env;
    expect(sc.data.balance.amount).toBe("1234.56");
    expect(typeof sc.data.balance.amount).toBe("string");
    expect(result.content[0]).toMatchObject({ type: "text" });
  });

  it("surfaces redaction and filtering in the text summary", async () => {
    const env = {
      data: [{ id: "t-1" }, { id: "t-2" }],
      pagination: { has_more: true, next_cursor: "c2" },
      redacted_fields: ["merchant"],
      filtered: true,
    };
    const result = await mapResponse(jsonResponse(env));
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("2 items");
    expect(text.toLowerCase()).toContain("hidden");
    expect(text.toLowerCase()).toContain("filtered");
    expect(text.toLowerCase()).toContain("cursor");
  });

  it("honors Idempotency-Replayed via _meta", async () => {
    const result = await mapResponse(
      jsonResponse({ data: { new_budget_id: "b-2", previous_budget_archived: true } }, 200, {
        "idempotency-replayed": "true",
      }),
    );
    expect(result._meta).toEqual({ idempotencyReplayed: true });
  });

  it("maps problem+json to a tool error with the slug from type and the detail", async () => {
    const problem = {
      type: "https://api.403fin.io/problems/insufficient-scope",
      title: "Insufficient scope",
      status: 403,
      detail: "The credential lacks the goals:write scope.",
      request_id: "req-123",
    };
    const result = await mapResponse(problemResponse(problem, 403));
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe("insufficient-scope");
    expect(sc.detail).toBe(problem.detail);
    expect(sc.status).toBe(403);
    expect(sc.request_id).toBe("req-123");
    expect((result.content[0] as { text: string }).text).toBe(problem.detail);
  });

  it("carries tier-required extension members", async () => {
    const problem = {
      type: "https://api.403fin.io/problems/tier-required",
      title: "Premium required",
      status: 402,
      detail: "This feature requires the premium tier.",
      current_tier: "pro",
      required_tier: "premium",
      feature: "public_api",
    };
    const result = await mapResponse(problemResponse(problem, 402));
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe("tier-required");
    expect(sc.required_tier).toBe("premium");
    expect(sc.feature).toBe("public_api");
  });

  it("surfaces 422 data-excluded as a tool error, not an empty result", async () => {
    const problem = {
      type: "https://api.403fin.io/problems/data-excluded",
      title: "Unavailable",
      status: 422,
      detail: "Net worth is unavailable because the connection excludes an account.",
    };
    const result = await mapResponse(problemResponse(problem, 422));
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe("data-excluded");
    expect(sc.detail).toContain("unavailable");
  });
});

describe("executeTool", () => {
  it("runs a read end to end and returns the envelope", async () => {
    const env = { data: [{ id: "acc-1", balance: { amount: "10.00", currency: "USD" } }] };
    const fetchImpl = vi.fn(async () => jsonResponse(env));
    const ctx: ClientContext = {
      baseUrl: BASE,
      credentials: staticCreds(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    const result = await executeTool(spec("list_accounts"), { page_size: 5 }, ctx);
    expect(result.isError).toBeFalsy();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ff_ak_test");
  });

  it("sends a generated Idempotency-Key on a write when none is provided", async () => {
    const captured: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      captured.push(init);
      return jsonResponse({ data: { new_budget_id: "b-2", previous_budget_archived: true } });
    });
    const ctx: ClientContext = {
      baseUrl: BASE,
      credentials: staticCreds(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      randomUUID: () => "fixed-uuid-1234",
    };
    await executeTool(spec("switch_budget_method"), { method: "envelope", confirm: true }, ctx);
    const headers = captured[0].headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("fixed-uuid-1234");
  });

  it("retries once through reauthorize on a 401, then succeeds", async () => {
    const responses = [
      problemResponse({ type: "https://api.403fin.io/problems/invalid-credential" }, 401),
      jsonResponse({ data: [] }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() as Response);
    const reauthorize = vi.fn(async () => true);
    const ctx: ClientContext = {
      baseUrl: BASE,
      credentials: {
        getCredential: vi.fn(async () => "ff_at_token"),
        reauthorize,
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    const result = await executeTool(spec("list_goals"), {}, ctx);
    expect(reauthorize).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeFalsy();
  });

  it("does not retry when reauthorize cannot recover (api key)", async () => {
    const fetchImpl = vi.fn(async () =>
      problemResponse(
        { type: "https://api.403fin.io/problems/invalid-credential", detail: "bad key" },
        401,
      ),
    );
    const ctx: ClientContext = {
      baseUrl: BASE,
      credentials: staticCreds(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    const result = await executeTool(spec("list_goals"), {}, ctx);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).error).toBe("invalid-credential");
  });
});
