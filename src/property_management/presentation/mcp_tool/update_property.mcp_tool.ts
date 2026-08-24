import type { UpdatePropertyUseCase } from "../../application/use_case/update_property";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { updatePropertyInput } from "../schema/update_property.schema";

export function makeUpdatePropertyTool(
  useCase: UpdatePropertyUseCase
): McpToolDefinition<typeof updatePropertyInput> {
  return {
    name: "update_property",
    description:
      "Partially updates a property administered by the authenticated user. Only the fields you send are changed.",
    inputSchema: updatePropertyInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute(
        {
          property_id: input.property_id,
          update_data: {
            name: input.name,
            address: input.address,
            images: input.images,
            capacity: input.capacity,
          },
        },
        user
      );
    },
  };
}
