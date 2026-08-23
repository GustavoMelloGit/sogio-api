import { z } from "zod";
import type { FindPropertyUseCase } from "../../application/use_case/find_property";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property to fetch. Must be a property administered by the authenticated user. Can be obtained via list_properties."
    ),
};

export function makeGetPropertyTool(
  useCase: FindPropertyUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "get_property",
    description:
      "Fetches a single property administered by the authenticated user, including its full address, capacity and images.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute({ property_id: input.property_id }, user);
    },
  };
}
