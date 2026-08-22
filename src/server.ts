import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ClientContext, executeTool } from "./client.js";
import { tools } from "./tools/index.js";
import { SERVER_NAME, VERSION } from "./version.js";

/**
 * Build the Forbidden Finance MCP server and register all 40 tools. Every tool is
 * a thin adapter over executeTool → the public /v1 API; no business logic lives
 * here. Reads are marked readOnly; the 11 writes carry an idempotent hint (they
 * are made safe to retry by an Idempotency-Key), and the ones that remove or
 * replace something the user already had — switch_budget_method, which archives
 * the current budget, plus the two deletes — are also flagged destructive.
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
          destructiveHint: spec.destructive,
          idempotentHint: spec.isWrite,
          openWorldHint: true,
        },
      },
      (args) => executeTool(spec, args as Record<string, unknown>, ctx),
    );
  }

  return server;
}
