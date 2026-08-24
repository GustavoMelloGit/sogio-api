import { z } from "zod";
import { tenantSexSchema } from "../../domain/entity/tenant";
import { MAX_STAY_PRICE_IN_CENTS } from "../../domain/entity/stay";
import { MAX_PROPERTY_CAPACITY } from "../../../property_management/domain/entity/property";

export const bookStayInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property to book. Must be a property administered by the authenticated user."
    ),
  guests: z
    .number()
    .int()
    .positive()
    .max(MAX_PROPERTY_CAPACITY)
    .describe("Number of guests staying."),
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
    .max(MAX_STAY_PRICE_IN_CENTS)
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
} satisfies z.ZodRawShape;
