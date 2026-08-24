import { z } from "zod";
import type { UpdateStayUseCase } from "../../application/use_case/stay/update_stay";
import { MAX_STAY_PRICE_IN_CENTS } from "../../domain/entity/stay";
import { MAX_PROPERTY_CAPACITY } from "../../../property_management/domain/entity/property";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export const inputSchema = {
  stay_id: z
    .uuid()
    .describe(
      "ID of the stay to update. Must belong to a property administered by the authenticated user."
    ),
  check_in: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .optional()
    .describe(
      "New check-in instant in ISO-8601 with an explicit UTC offset, e.g. 2026-08-10T14:00:00-03:00. Omit to keep the current one."
    ),
  check_out: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .optional()
    .describe(
      "New check-out instant in ISO-8601 with an explicit UTC offset, e.g. 2026-08-12T11:00:00-03:00. Must be strictly after check_in. Omit to keep the current one."
    ),
  guests: z
    .number()
    .int()
    .positive()
    .max(MAX_PROPERTY_CAPACITY)
    .optional()
    .describe("New number of guests. Omit to keep the current one."),
  price: z
    .int()
    .positive()
    .max(MAX_STAY_PRICE_IN_CENTS)
    .optional()
    .describe(
      "New total stay price in cents, e.g. 100000 for R$ 1.000,00. Omit to keep the current one."
    ),
};

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
