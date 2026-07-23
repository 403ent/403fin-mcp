import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ClientContext, executeTool } from "./client.js";
import { tools } from "./tools/index.js";
import { SERVER_NAME, VERSION } from "./version.js";

/**
 * Build the Forbidden Finance MCP server and register all 32 tools. Every tool is
 * a thin adapter over executeTool → the public /v1 API; no business logic lives
 * here. Reads are marked readOnly; the three writes carry an idempotent hint (they
 * are made safe to retry by an Idempotency-Key), and switch_budget_method is also
 * flagged destructive (it archives the current budget).
 */
export function createServer(ctx: ClientContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });

  for (const spec of tools) {
    server.registerTool(
      spec.toolName,
      {
        description: spec.description,
        inputSchema: spec.inputShape,
        annotations: {
          title: spec.toolName,
          readOnlyHint: !spec.isWrite,
          destructiveHint: spec.toolName === "switch_budget_method",
          idempotentHint: spec.isWrite,
          openWorldHint: true,
        },
      },
      (args) => executeTool(spec, args as Record<string, unknown>, ctx),
    );
  }

  return server;
}
