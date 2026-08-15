import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { User } from "../../../auth/domain/entity/user";
import { registerMcpTool, type McpToolDefinition } from "./mcp_tool";

export type CreateMcpServerOptions = {
  name: string;
  version: string;
  user: User;
  tools?: McpToolDefinition<z.ZodRawShape>[];
};

/**
 * Builds an MCP server for a single request, wired to the Sogio error
 * mapping pipeline and bound to `user` — the caller already resolved by the
 * transport gate in `routes.ts` before this server was even instantiated.
 * Every tool registered through `registerMcpTool` (or passed in `tools`)
 * receives that same `user`, maps typed domain errors to tool errors, and
 * serializes dates. Identity resolution itself does not happen here or in
 * any tool handler.
 *
 * The returned server still needs a transport to be usable — connect it via
 * `server.connect(transport)`. The SDK's `WebStandardStreamableHTTPServerTransport`
 * (`@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`) works
 * directly with `Bun.serve`'s `Request`/`Response` objects and is the
 * transport this server is designed to be mounted with.
 */
export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer(
    { name: options.name, version: options.version },
    { capabilities: { tools: {} } }
  );

  for (const tool of options.tools ?? []) {
    registerMcpTool(server, options.user, tool);
  }

  return server;
}
