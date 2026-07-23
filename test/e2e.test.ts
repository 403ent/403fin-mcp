import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CredentialProvider } from "../src/auth/types.js";
import { type ClientContext, executeTool } from "../src/client.js";
import { toolByName } from "../src/tools/index.js";

// A recorded inbound request against the mock /v1 server.
interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function staticCreds(token = "ff_ak_e2e"): CredentialProvider {
  return {
    getCredential: () => Promise.resolve(token),
    reauthorize: () => Promise.resolve(false),
  };
}

describe("end-to-end against a mock /v1 server", () => {
  let server: Server;
  let baseUrl: string;
  const recorded: Recorded[] = [];

  beforeEach(async () => {
    recorded.length = 0;
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const body = await readBody(req);
      recorded.push({
        method: req.method ?? "",
        path: url.pathname + url.search,
        headers: req.headers,
        body,
      });

      // READ: GET /v1/accounts → an envelope with a money decimal string.
      if (req.method === "GET" && url.pathname === "/v1/accounts") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              {
                id: "acc-1",
                name: "Checking",
                balance: { amount: "2500.7500", currency: "USD" },
              },
            ],
            pagination: { has_more: false },
            redacted_fields: [],
            filtered: false,
          }),
        );
        return;
      }

      // WRITE: POST /v1/goals/{id}/contributions → replay-aware envelope.
      if (req.method === "POST" && /^\/v1\/goals\/[^/]+\/contributions$/.test(url.pathname)) {
        const replay = req.headers["idempotency-key"] === "seen-before";
        res.writeHead(200, {
          "content-type": "application/json",
          ...(replay ? { "idempotency-replayed": "true" } : {}),
        });
        res.end(
          JSON.stringify({
            data: {
              contribution: { id: "con-1", amount: "50.0000", currency: "USD" },
              progress: { goal_id: "g-1", current_amount: "550.0000" },
            },
          }),
        );
        return;
      }

      res.writeHead(404, { "content-type": "application/problem+json" });
      res.end(
        JSON.stringify({
          type: "https://api.403fin.io/problems/not-found",
          title: "Not found",
          status: 404,
          detail: "no route",
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function ctx(): ClientContext {
    return { baseUrl, credentials: staticCreds() };
  }

  it("read: list_accounts returns the envelope with money strings intact", async () => {
    const tool = toolByName("list_accounts");
    if (!tool) {
      throw new Error("missing tool");
    }
    const result = await executeTool(tool, { page_size: 10 }, ctx());
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { data: Array<{ balance: { amount: string } }> };
    expect(sc.data[0].balance.amount).toBe("2500.7500");
    expect(typeof sc.data[0].balance.amount).toBe("string");

    const req = recorded.at(-1);
    expect(req?.method).toBe("GET");
    expect(req?.path).toBe("/v1/accounts?page_size=10");
    expect(req?.headers.authorization).toBe("Bearer ff_ak_e2e");
    expect(req?.headers["idempotency-key"]).toBeUndefined();
  });

  it("write: record_goal_contribution sends an Idempotency-Key and body, returns progress", async () => {
    const tool = toolByName("record_goal_contribution");
    if (!tool) {
      throw new Error("missing tool");
    }
    const result = await executeTool(
      tool,
      { id: "g-1", amount: "50.0000", idempotency_key: "key-xyz" },
      ctx(),
    );
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      data: { progress: { current_amount: string } };
    };
    expect(sc.data.progress.current_amount).toBe("550.0000");

    const req = recorded.at(-1);
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe("/v1/goals/g-1/contributions");
    expect(req?.headers["idempotency-key"]).toBe("key-xyz");
    expect(JSON.parse(req?.body ?? "{}")).toEqual({ amount: "50.0000" });
  });

  it("write: replayed idempotent write is flagged via _meta", async () => {
    const tool = toolByName("record_goal_contribution");
    if (!tool) {
      throw new Error("missing tool");
    }
    const result = await executeTool(
      tool,
      { id: "g-1", amount: "50.0000", idempotency_key: "seen-before" },
      ctx(),
    );
    expect(result._meta).toEqual({ idempotencyReplayed: true });
  });
});
