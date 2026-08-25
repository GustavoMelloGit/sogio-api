import type { ListTenantsUseCase } from "../../application/use_case/tenant/list_tenents";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { tenantSearchQuery } from "../schema/list_tenants.schema";

export const inputSchema = { query: tenantSearchQuery };

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
