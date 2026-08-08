import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { McpIdentityResolver } from "./identity_resolver";
import { registerMcpTool, type McpToolDefinition } from "./mcp_tool";

export type CreateMcpServerOptions = {
  name: string;
  version: string;
  identityResolver: McpIdentityResolver;
  tools?: McpToolDefinition<z.ZodRawShape>[];
};

/**
 * Builds an MCP server wired to the StayHub identity resolution and error
 * mapping pipeline. Every tool registered through `registerMcpTool` (or
 * passed in `tools`) already resolves the calling user from the bearer
 * token, maps typed domain errors to tool errors, and serializes dates.
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
    registerMcpTool(server, options.identityResolver, tool);
  }

  return server;
}
