import { z } from "zod";
import {
  boundedJsonValue,
  settingTypeSchema,
} from "../../../core/domain/value_object/setting_value";

export const updatePropertySettingInput = {
  property_id: z
    .uuid()
    .describe(
      "ID of the property the setting belongs to. Must be a property administered by the authenticated user."
    ),
  id: z
    .uuid()
    .describe(
      "ID of the property setting to update. Must belong to the given property. Can be obtained via list_property_settings. The setting's key is immutable and cannot be changed."
    ),
  value: boundedJsonValue
    .optional()
    .describe(
      "New value for this setting. Must match the shape implied by `type` (the new one if provided, otherwise the existing one). Omit to leave the value unchanged."
    ),
  type: settingTypeSchema
    .optional()
    .describe(
      `New type for the value. Must be one of: ${settingTypeSchema.options.join(", ")}. Omit to leave the type unchanged.`
    ),
  description: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .describe(
      "New free-text description. Pass null to clear it, or omit to leave it unchanged."
    ),
} satisfies z.ZodRawShape;
