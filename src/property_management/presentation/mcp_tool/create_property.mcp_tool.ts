import { z } from "zod";
import type { CreatePropertyUseCase } from "../../application/use_case/create_property";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { MAX_PROPERTY_CAPACITY } from "../../domain/entity/property";

export const MAX_PROPERTY_IMAGES = 50;

const addressSchema = z.object({
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
    .max(100, "Complement must be at most 100 characters")
    .default(""),
});

const inputSchema = {
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters")
    .describe("Name the owner uses to identify the property."),
  address: addressSchema.describe(
    "Full address of the property. complement is optional and defaults to an empty string."
  ),
  capacity: z
    .number()
    .int("Capacity must be an integer")
    .positive("Capacity must be greater than 0")
    .max(
      MAX_PROPERTY_CAPACITY,
      `Capacity must be at most ${MAX_PROPERTY_CAPACITY}`
    )
    .describe("Maximum number of guests the property accommodates."),
  images: z
    .array(z.string().max(2048, "Image URL must be at most 2048 characters"))
    .max(MAX_PROPERTY_IMAGES, `At most ${MAX_PROPERTY_IMAGES} images`)
    .optional()
    .describe("URLs of the property photos. Omit for none."),
};

export function makeCreatePropertyTool(
  useCase: CreatePropertyUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "create_property",
    description:
      "Registers a single property for the authenticated user. Use this to add one property, not import_properties, which is meant for migrating an existing spreadsheet and is not idempotent. Refused when the account has already reached the property limit of its plan.",
    inputSchema,
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
