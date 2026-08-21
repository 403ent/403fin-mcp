// The server version reported to MCP clients. Kept in sync with package.json by
// a test (test/version.test.ts) so a release bump can't silently drift.
export const VERSION = "1.0.0";

/** The MCP server name, shared by the server and OAuth dynamic client registration. */
export const SERVER_NAME = "forbidden-finance";
