import { z } from "zod";
import type { ListTenantsUseCase } from "../../application/use_case/tenant/list_tenents";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export const inputSchema = {
  query: z
    .string()
    .max(100)
    .optional()
    .describe(
      "Optional filter on the guest name, case-insensitive and matching any part of it. Omit to list every guest."
    ),
};

export function makeListTenantsTool(
  useCase: ListTenantsUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "list_tenants",
    description:
      "Lists the guests who have stays in properties administered by the authenticated user. The result is not paginated.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute({ query: input.query }, user);
    },
  };
}
