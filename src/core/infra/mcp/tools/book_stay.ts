import { z } from "zod";
import type { PropertyDi } from "../../../../booking/infra/di/property_di";
import { tenantSexSchema } from "../../../../booking/domain/entity/tenant";
import type { McpToolDefinition } from "../mcp_tool";

export const inputSchema = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property to book. Must be a property administered by the authenticated user."
    ),
  guests: z.number().int().positive().describe("Number of guests staying."),
  check_in: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .describe(
      "Check-in instant in ISO-8601 with an explicit UTC offset, e.g. 2026-08-10T14:00:00-03:00. A date without a time or an offset-less datetime is rejected."
    ),
  check_out: z.iso
    .datetime({ offset: true })
    .transform(value => new Date(value))
    .describe(
      "Check-out instant in ISO-8601 with an explicit UTC offset, e.g. 2026-08-12T11:00:00-03:00. Must be strictly after check_in."
    ),
  price: z
    .int()
    .nonnegative()
    .describe(
      "Total stay price in cents, e.g. 100000 for R$ 1.000,00. Must be a non-negative integer."
    ),
  source: z
    .string()
    .max(100)
    .describe(
      "Booking source/channel, e.g. DIRECT for a stay booked directly with the host, or the name of the external platform (AIRBNB, BOOKING, ...)."
    ),
  tenant: z
    .object({
      name: z
        .string()
        .min(3)
        .max(100)
        .describe("Full name of the guest staying at the property."),
      phone: z
        .string()
        .regex(/^[0-9]+$/, "Phone must contain only numbers")
        .min(10)
        .max(15)
        .describe(
          "Guest phone number, digits only (no spaces, dashes or +), including country and area code, e.g. 5511999990000."
        ),
      sex: tenantSexSchema.describe("Guest's sex."),
    })
    .describe(
      "Guest identification. If a tenant with the same phone already exists it is reused; otherwise a new tenant is created."
    ),
};

/**
 * Wires the existing `BookStayUseCase` (already used by the
 * `/booking/property/:property_id/book` HTTP route) as a destructive MCP
 * tool. `entrance_code` is intentionally absent from the input schema: the
 * use case always generates it via `EntranceCodeGenerator` when the field is
 * missing from its input, and this channel must never accept a caller-chosen
 * lock code. Booking a stay dispatches `StayBookedEvent`, which creates a
 * real temporary password on the property's physical lock and books revenue
 * in the ledger. `entrance_code` is likewise stripped from the use case's
 * output before it reaches the tool result: it is a real physical lock
 * password and must never be sent into an LLM's context.
 */
export function makeBookStayTool(
  propertyDi: PropertyDi
): McpToolDefinition<typeof inputSchema> {
  const useCase = propertyDi.makeBookStayUseCase();

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
