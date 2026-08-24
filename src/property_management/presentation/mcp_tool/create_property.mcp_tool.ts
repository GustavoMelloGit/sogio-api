import type { CreatePropertyUseCase } from "../../application/use_case/create_property";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { createPropertyInput } from "../schema/create_property.schema";

export function makeCreatePropertyTool(
  useCase: CreatePropertyUseCase
): McpToolDefinition<typeof createPropertyInput> {
  return {
    name: "create_property",
    description:
      "Registers a single property for the authenticated user. Use this to add one property, not import_properties, which is meant for migrating an existing spreadsheet and is not idempotent. Refused when the account has already reached the property limit of its plan.",
    inputSchema: createPropertyInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    handler: async (input, user) => {
      return useCase.execute({
        name: input.name,
        user_id: user.id,
        address: input.address,
        images: input.images ?? [],
        capacity: input.capacity,
      });
    },
  };
}
