import type { PropertyManagementDi } from "../../../../property_management/infra/di/property_management_di";
import type { McpToolDefinition } from "../../../presentation/mcp_tool/mcp_tool";

/**
 * Wires the existing `FindUserPropertiesUseCase` (already used by the
 * `/property/user/all` HTTP route) as a read-only MCP tool. No orchestration
 * happens here beyond calling the use case with the resolved user.
 */
export function makeListPropertiesTool(
  propertyManagementDi: PropertyManagementDi
): McpToolDefinition {
  const useCase = propertyManagementDi.makeFindUserPropertiesUseCase();

  return {
    name: "list_properties",
    description: "Lists the properties administered by the authenticated user.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
    },
    handler: async (_input, user) => useCase.execute({ user_id: user.id }),
  };
}
