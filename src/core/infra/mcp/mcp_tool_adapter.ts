import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { User } from "../../../auth/domain/entity/user";
import type { McpToolDefinition } from "../../presentation/mcp_tool/mcp_tool";
import { serializeDatesRecursively } from "../http/utils/date_serializer";
import { mapErrorToToolResult } from "./mcp_error_mapper";

/**
 * Registers a tool bound to the `user` already resolved by the transport
 * gate in `routes.ts` for the current request. `user` is closed over by the
 * handler rather than re-resolved per call: identity resolution happens once
 * per HTTP request, not once per tool invocation.
 */
export function registerMcpTool(
  server: McpServer,
  user: User,
  definition: McpToolDefinition<z.ZodRawShape>
): RegisteredTool {
  return server.registerTool(
    definition.name,
    {
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.annotations,
    },
    async (input): Promise<CallToolResult> => {
      try {
        const output = await definition.handler(input, user);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(serializeDatesRecursively(output)),
            },
          ],
        };
      } catch (error) {
        return mapErrorToToolResult(error);
      }
    }
  );
}
