import type { UpdateStayUseCase } from "../../application/use_case/stay/update_stay";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { updateStayInput } from "../schema/update_stay.schema";

export const inputSchema = updateStayInput;

export function makeUpdateStayTool(
  useCase: UpdateStayUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "update_stay",
    description:
      "Changes the dates, guest count or price of a stay already booked. Only the fields you send are changed. New dates are checked against the other stays of the property, so a move that overlaps another stay is rejected. Cancelling a stay is a different action — use cancel_stay.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
    handler: async (input, user) => {
      const { entrance_code: _entranceCode, ...updated } =
        await useCase.execute(input, user);

      return updated;
    },
  };
}
