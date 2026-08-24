import type { BookStayUseCase } from "../../application/use_case/property/book_stay";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { bookStayInput } from "../schema/book_stay.schema";

export const inputSchema = bookStayInput;

export function makeBookStayTool(
  useCase: BookStayUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "book_stay",
    description:
      "Books a stay for a property. Triggers the physical door lock (a temporary entrance code is generated automatically) and records revenue — this is a destructive, non-idempotent action.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    handler: async (input, user) => {
      const { entrance_code, ...rest } = await useCase.execute(
        {
          guests: input.guests,
          property_id: input.property_id,
          check_in: input.check_in,
          check_out: input.check_out,
          price: input.price,
          source: input.source,
          tenant: input.tenant,
        },
        user
      );

      return rest;
    },
  };
}
