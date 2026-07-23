import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CredentialProvider } from "./auth/types.js";
import type { ToolSpec } from "./tools/types.js";

/** The standard /v1 response wrapper. */
export interface Envelope {
  data: unknown;
  pagination?: { next_cursor?: string; has_more?: boolean } | null;
  redacted_fields?: string[];
  filtered?: boolean;
}

/** An RFC 9457 problem document (extension members flattened at top level). */
export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  request_id?: string;
  current_tier?: string;
  required_tier?: string;
  feature?: string;
}

export interface ClientContext {
  baseUrl: string;
  credentials: CredentialProvider;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
  userAgent?: string;
}

/** A fully-built HTTP request, WITHOUT the Authorization header (added at send). */
export interface RequestPlan {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null;
}

/**
 * Build the /v1 request for a tool call: interpolate path params, append query
 * params, and JSON-encode body params. Never sets Authorization — the credential
 * is attached only at send time so it can never leak into a logged plan.
 */
export function planRequest(
  spec: ToolSpec,
  args: Record<string, unknown>,
  baseUrl: string,
  idempotencyKey?: string,
): RequestPlan {
  let path = spec.path;
  for (const name of spec.pathParams) {
    const value = args[name];
    if (!isPresent(value)) {
      throw new Error(`Missing required path parameter: ${name}`);
    }
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }

  const url = new URL(baseUrl + path);
  for (const name of spec.queryParams) {
    const value = args[name];
    if (!isPresent(value)) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(name, String(item));
      }
    } else {
      url.searchParams.set(name, String(value));
    }
  }

  const headers: Record<string, string> = { accept: "application/json" };

  let body: string | undefined;
  if (spec.bodyParams.length > 0) {
    const payload: Record<string, unknown> = {};
    for (const name of spec.bodyParams) {
      const value = args[name];
      if (isPresent(value)) {
        payload[name] = value;
      }
    }
    body = JSON.stringify(payload);
    headers["content-type"] = "application/json";
  }

  if (spec.isWrite && idempotencyKey) {
    headers["idempotency-key"] = idempotencyKey;
  }

  return { url: url.toString(), method: spec.method, headers, body };
}

function problemSlug(problem: Problem | undefined, status: number): string {
  const type = problem?.type;
  if (typeof type === "string" && type.length > 0) {
    const tail = type.replace(/\/+$/, "").split("/").pop();
    if (tail) {
      return tail;
    }
  }
  return `http-${status}`;
}

function toolError(
  slug: string,
  detail: string,
  status: number,
  problem?: Problem,
): CallToolResult {
  const structured: Record<string, unknown> = { error: slug, detail };
  if (status > 0) {
    structured.status = status;
  }
  if (problem?.title) {
    structured.title = problem.title;
  }
  if (problem?.request_id) {
    structured.request_id = problem.request_id;
  }
  if (problem?.current_tier) {
    structured.current_tier = problem.current_tier;
  }
  if (problem?.required_tier) {
    structured.required_tier = problem.required_tier;
  }
  if (problem?.feature) {
    structured.feature = problem.feature;
  }
  return {
    isError: true,
    content: [{ type: "text", text: detail }],
    structuredContent: structured,
  };
}

function summarize(env: Envelope, replayed: boolean): string {
  const parts: string[] = [];
  const data = env.data;
  if (Array.isArray(data)) {
    parts.push(`Returned ${data.length} item${data.length === 1 ? "" : "s"}.`);
  } else if (data && typeof data === "object") {
    parts.push("Returned 1 result.");
  } else {
    parts.push("Request succeeded.");
  }
  if (env.redacted_fields && env.redacted_fields.length > 0) {
    parts.push(
      `${env.redacted_fields.length} field(s) hidden by the connection's privacy settings.`,
    );
  }
  if (env.filtered) {
    parts.push("Some rows or aggregates were filtered by the connection's privacy settings.");
  }
  if (env.pagination?.has_more) {
    parts.push("More results are available; pass the returned cursor to continue.");
  }
  if (replayed) {
    parts.push("This was an idempotent replay of a previous write.");
  }
  return parts.join(" ");
}

/** Map an HTTP response to an MCP tool result (envelope success or problem error). */
export async function mapResponse(res: Response): Promise<CallToolResult> {
  const replayed = res.headers.get("idempotency-replayed") === "true";
  const text = await res.text();

  if (res.ok) {
    let env: Envelope;
    try {
      env = JSON.parse(text) as Envelope;
    } catch {
      return toolError("internal", "The API returned a non-JSON success response.", res.status);
    }
    const result: CallToolResult = {
      content: [{ type: "text", text: summarize(env, replayed) }],
      structuredContent: env as unknown as Record<string, unknown>,
    };
    if (replayed) {
      result._meta = { idempotencyReplayed: true };
    }
    return result;
  }

  let problem: Problem | undefined;
  try {
    problem = JSON.parse(text) as Problem;
  } catch {
    problem = undefined;
  }
  const slug = problemSlug(problem, res.status);
  const detail = problem?.detail || problem?.title || `Request failed with HTTP ${res.status}.`;
  return toolError(slug, detail, res.status, problem);
}

async function send(plan: RequestPlan, credential: string, ctx: ClientContext): Promise<Response> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    ...plan.headers,
    authorization: `Bearer ${credential}`,
  };
  if (ctx.userAgent) {
    headers["user-agent"] = ctx.userAgent;
  }
  return doFetch(plan.url, { method: plan.method, headers, body: plan.body });
}

/**
 * Execute a tool call end to end: build the request, attach the credential, send,
 * retry once through reauthorize() on a 401, and map the response. Writes always
 * carry an Idempotency-Key (the caller's, or a fresh random UUID).
 */
export async function executeTool(
  spec: ToolSpec,
  args: Record<string, unknown>,
  ctx: ClientContext,
): Promise<CallToolResult> {
  const gen = ctx.randomUUID ?? randomUUID;
  const provided = args.idempotency_key;
  const idempotencyKey = spec.isWrite
    ? typeof provided === "string" && provided.length > 0
      ? provided
      : gen()
    : undefined;

  let plan: RequestPlan;
  try {
    plan = planRequest(spec, args, ctx.baseUrl, idempotencyKey);
  } catch (e) {
    return toolError("validation", e instanceof Error ? e.message : "Invalid arguments.", 0);
  }

  try {
    let res = await send(plan, await ctx.credentials.getCredential(), ctx);
    if (res.status === 401) {
      const recovered = await ctx.credentials.reauthorize();
      if (recovered) {
        res = await send(plan, await ctx.credentials.getCredential(), ctx);
      }
    }
    return await mapResponse(res);
  } catch (e) {
    return toolError(
      "network",
      e instanceof Error ? e.message : "The request could not be completed.",
      0,
    );
  }
}
