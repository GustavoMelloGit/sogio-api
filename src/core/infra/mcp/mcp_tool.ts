import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  IsomorphicHeaders,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { User } from "../../../auth/domain/entity/user";
import { serializeDatesRecursively } from "../http/utils/date_serializer";
import type { McpIdentityResolver } from "./identity_resolver";
import { mapErrorToToolResult } from "./mcp_error_mapper";

export type McpToolInput<Shape extends z.ZodRawShape> = {
  [Key in keyof Shape]: z.infer<Shape[Key]>;
};

export type McpToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: Shape;
  annotations?: ToolAnnotations;
  /**
   * Declared with method shorthand (bivariant parameter checking) on purpose:
   * it lets `registerMcpTool` accept any `McpToolDefinition<Shape>` through a
   * single non-generic parameter typed `McpToolDefinition<z.ZodRawShape>`,
   * which is what keeps the Zod SDK's own generic `registerTool` inference
   * well-behaved (passing a still-generic Shape through it collapses to its
   * index-signature constraint). Type safety at each tool's authoring site
   * is unaffected, since `Shape` is concrete there.
   */
  handler(input: McpToolInput<Shape>, user: User): Promise<unknown>;
};

export function registerMcpTool(
  server: McpServer,
  identityResolver: McpIdentityResolver,
  definition: McpToolDefinition<z.ZodRawShape>
): RegisteredTool {
  return server.registerTool(
    definition.name,
    {
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.annotations,
    },
    async (input, extra): Promise<CallToolResult> => {
      try {
        const authorizationHeader = extractAuthorizationHeader(
          extra.requestInfo?.headers
        );
        const user = await identityResolver.resolveUser(authorizationHeader);
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

function extractAuthorizationHeader(
  headers: IsomorphicHeaders | undefined
): string | undefined {
  const value = headers?.authorization;

  return Array.isArray(value) ? value[0] : value;
}
