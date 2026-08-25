import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { User } from "../../../auth/domain/entity/user";
import type { CapabilityKey } from "../../../billing/domain/capability/capability_key";
import { capabilityRegistryEntryOf } from "../../../billing/domain/capability/capability_registry";
import type { CapabilitySet } from "../../../billing/domain/capability/capability_set";
import { ForbiddenError } from "../../application/error/forbidden_error";
import { TooManyRequestsError } from "../../application/error/too_many_requests_error";
import type { RateLimiter } from "../../application/rate_limit/rate_limiter";
import type { McpToolDefinition } from "../../presentation/mcp_tool/mcp_tool";
import { InMemoryRateLimiter } from "../rate_limit/in_memory_rate_limiter";
import { serializeDatesRecursively } from "../http/utils/date_serializer";
import { mapErrorToToolResult } from "./mcp_error_mapper";

function buildToolRateLimitKey(toolName: string, userId: string): string {
  return `tool:${toolName}:${userId}`;
}

/**
 * Registers a tool bound to the `user` already resolved by the transport
 * gate in `routes.ts` for the current request. `user` is closed over by the
 * handler rather than re-resolved per call: identity resolution happens once
 * per HTTP request, not once per tool invocation.
 */
export function registerMcpTool(
  server: McpServer,
  user: User,
  capabilities: CapabilitySet,
  definition: McpToolDefinition<z.ZodRawShape>,
  rateLimiter: RateLimiter = new InMemoryRateLimiter()
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
        if (definition.rateLimitPolicy) {
          const decision = rateLimiter.consume(
            buildToolRateLimitKey(definition.name, user.id),
            definition.rateLimitPolicy
          );
          if (!decision.allowed) {
            throw new TooManyRequestsError(decision.retryAfterSeconds);
          }
        }

        if (
          definition.requiredCapability &&
          user.role !== "admin" &&
          !capabilities.allows(definition.requiredCapability)
        ) {
          throw new ForbiddenError(
            capabilityDeniedMessage(definition.requiredCapability)
          );
        }

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

function capabilityDeniedMessage(key: CapabilityKey): string {
  const { label } = capabilityRegistryEntryOf(key);
  return `Your current plan doesn't include ${label}. Upgrade your plan to unlock it.`;
}
