import type { ZodRawShape } from "zod";

// One MCP tool, generated from an OpenAPI operation. See scripts/generate-tools.ts.
export interface ToolSpec {
  /** MCP tool name (snake_case), e.g. "list_accounts". */
  toolName: string;
  /** OpenAPI operationId, e.g. "listAccounts". The description-overlay key. */
  operationId: string;
  /** HTTP method for the /v1 request. */
  method: string;
  /** Path template with {name} placeholders, e.g. "/v1/accounts/{id}". */
  path: string;
  /**
   * True iff the operation declares a required Idempotency-Key header — the
   * write discriminator. NOT the HTTP verb: computeDebtPayoffPlan is POST but a
   * read. Writes send the Idempotency-Key header.
   */
  isWrite: boolean;
  /**
   * True iff calling this tool REMOVES or REPLACES something the user already
   * had. Pinned in scripts/generate-tools.ts (DESTRUCTIVE_TOOLS), not derived
   * from the spec, and mirrors the gateway's own set — it feeds destructiveHint,
   * whose protocol default is true, so every additive write must say false.
   */
  destructive: boolean;
  /** Input field names that interpolate into the path template. */
  pathParams: string[];
  /** Input field names appended as query-string parameters. */
  queryParams: string[];
  /** Input field names carried in the JSON request body. */
  bodyParams: string[];
  /** Tool description, verbatim from src/descriptions.ts. */
  description: string;
  /** Zod raw shape registered as the tool's inputSchema. */
  inputShape: ZodRawShape;
}
