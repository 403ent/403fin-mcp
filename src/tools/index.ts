import { tools } from "./generated.js";
import type { ToolSpec } from "./types.js";

export { tools } from "./generated.js";
export type { ToolSpec } from "./types.js";

/** The three write tools (those that send an Idempotency-Key header). */
export const writeTools: ToolSpec[] = tools.filter((t) => t.isWrite);

/** Look up a tool by its MCP name. */
export function toolByName(name: string): ToolSpec | undefined {
  return tools.find((t) => t.toolName === name);
}
