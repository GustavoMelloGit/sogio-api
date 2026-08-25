import { z } from "zod";
import {
  MAX_PROPERTY_CAPACITY,
  MAX_PROPERTY_IMAGES,
} from "../../domain/entity/property";

const addressPatchSchema = z
  .object({
    street: z
      .string()
      .min(1, "Street is required")
      .max(100, "Street must be at most 100 characters"),
    number: z
      .string()
      .min(1, "Number is required")
      .max(20, "Number must be at most 20 characters"),
    neighborhood: z
      .string()
      .min(1, "Neighborhood is required")
      .max(100, "Neighborhood must be at most 100 characters"),
    city: z
      .string()
      .min(1, "City is required")
      .max(100, "City must be at most 100 characters"),
    state: z
      .string()
      .min(1, "State is required")
      .max(100, "State must be at most 100 characters"),
    zip_code: z
      .string()
      .min(1, "Zip code is required")
      .max(20, "Zip code must be at most 20 characters"),
    country: z
      .string()
      .min(1, "Country is required")
      .max(100, "Country must be at most 100 characters"),
    complement: z
      .string()
      .max(100, "Complement must be at most 100 characters"),
  })
  .partial();

export const updatePropertyInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property to update. Must be a property administered by the authenticated user."
    ),
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters")
    .optional()
    .describe("New name for the property. Omit to leave it unchanged."),
  address: addressPatchSchema
    .optional()
    .describe(
      "Address fields to change. Every field is optional: the ones you omit keep their current value, so a single field can be corrected without resending the whole address. Omit the object entirely to leave the address unchanged."
    ),
  capacity: z
    .number()
    .int("Capacity must be an integer")
    .positive("Capacity must be greater than 0")
    .max(
      MAX_PROPERTY_CAPACITY,
      `Capacity must be at most ${MAX_PROPERTY_CAPACITY}`
    )
    .optional()
    .describe(
      "New maximum number of guests. Omit to leave it unchanged. Lowering it does not cancel stays already booked above the new capacity."
    ),
  images: z
    .array(z.string().max(2048, "Image URL must be at most 2048 characters"))
    .max(MAX_PROPERTY_IMAGES, `At most ${MAX_PROPERTY_IMAGES} images`)
    .optional()
    .describe(
      "Replaces the whole list of photo URLs. Send the full list you want to keep, not just the new ones. Omit to leave it unchanged."
    ),
} satisfies z.ZodRawShape;
