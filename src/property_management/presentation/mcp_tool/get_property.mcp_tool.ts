import type { FindPropertyUseCase } from "../../application/use_case/find_property";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { findPropertyInput } from "../schema/find_property.schema";

export function makeGetPropertyTool(
  useCase: FindPropertyUseCase
): McpToolDefinition<typeof findPropertyInput> {
  return {
    name: "get_property",
    description:
      "Fetches a single property administered by the authenticated user, including its full address, capacity and images.",
    inputSchema: findPropertyInput,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute({ property_id: input.property_id }, user);
    },
  };
}
