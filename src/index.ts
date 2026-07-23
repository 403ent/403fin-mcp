#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCredentialProvider } from "./auth/select.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { SERVER_NAME, VERSION } from "./version.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const credentials = createCredentialProvider(config);

  const server = createServer({
    baseUrl: config.baseUrl,
    credentials,
    randomUUID,
    userAgent: `${SERVER_NAME}-mcp/${VERSION}`,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // stdout is the MCP transport — all diagnostics go to stderr, and never secrets.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[403fin-mcp] fatal: ${message}\n`);
  process.exit(1);
});
