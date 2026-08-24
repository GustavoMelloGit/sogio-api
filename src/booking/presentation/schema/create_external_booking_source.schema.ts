import { z } from "zod";
import { KNOWN_EXTERNAL_BOOKING_PLATFORMS } from "../../domain/entity/external_booking_source";

const PLATFORM_NAME_DESCRIPTION =
  "Name of the external platform the calendar comes from. Any provider that " +
  "publishes an iCal feed works, not just a fixed list. Known examples: " +
  KNOWN_EXTERNAL_BOOKING_PLATFORMS.join(", ") +
  ". Stored as an uppercase slug: the value is normalized (trimmed, " +
  "uppercased, spaces/hyphens collapsed to underscores) before being saved.";

export const createExternalBookingSourceInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the calendar belongs to. Must be a property administered by the authenticated user."
    ),
  platform_name: z
    .string()
    .max(50)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9 _-]{1,49}$/,
      "Platform name must be 2-50 characters, starting with a letter or " +
        "digit, using only letters, digits, spaces, underscores or hyphens"
    )
    .describe(PLATFORM_NAME_DESCRIPTION),
  sync_url: z
    .url()
    .max(2048)
    .describe(
      "Public iCal URL exported by the platform, e.g. https://www.airbnb.com/calendar/ical/12345.ics. Copy it from the platform's calendar export screen."
    ),
} satisfies z.ZodRawShape;
