import type { GetStayUseCase } from "../../application/use_case/stay/get_stay";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { getStayInput } from "../schema/get_stay.schema";

export const inputSchema = getStayInput;

export function makeGetStayTool(
  useCase: GetStayUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "get_stay",
    description:
      "Reads one stay in full, including the guest and the entrance_code that opens the property's door lock. Ask for one stay at a time, only when the user asked about that stay — list_stays deliberately omits the entrance code so a single call never exposes every guest's door code at once.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute({ stay_id: input.stay_id }, user);
    },
  };
}
