import { toPaginationInput } from "../../../core/application/dto/pagination";
import type { FindPropertyStaysUseCase } from "../../application/use_case/stay/find_property_stays";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { findPropertyStaysInput } from "../schema/find_property_stays.schema";

const inputSchema = findPropertyStaysInput;

export function makeListStaysTool(
  useCase: FindPropertyStaysUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "list_stays",
    description: "Lists the stays booked for a property, paginated.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      const { data, pagination } = await useCase.execute(
        {
          property_id: input.property_id,
          pagination: toPaginationInput(input),
          filters: { from: input.from, to: input.to },
        },
        user
      );

      return {
        data: data.map(({ entrance_code, ...rest }) => rest),
        pagination,
      };
    },
  };
}
