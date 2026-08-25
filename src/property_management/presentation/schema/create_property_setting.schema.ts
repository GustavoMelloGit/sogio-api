import { z } from "zod";
import {
  boundedJsonValue,
  settingKeySchema,
  settingTypeSchema,
} from "../../../core/domain/value_object/setting_value";

export const createPropertySettingInput = {
  property_id: z
    .uuid("Property ID must be a valid UUID")
    .describe(
      "ID of the property the setting should be created for. Must be a property administered by the authenticated user."
    ),
  key: settingKeySchema.describe(
    "Unique key for this setting within the property. Lowercase letters, digits, underscores, dots and hyphens only. Must not look like a secret/credential name (e.g. token, password, api_key, pin) — this is a generic configuration store, not a secrets manager."
  ),
  value: boundedJsonValue.describe(
    "Value for this setting. Must match the shape implied by `type` (string, number, boolean, or a JSON object)."
  ),
  type: settingTypeSchema.describe(
    `Type of the value. Must be one of: ${settingTypeSchema.options.join(", ")}.`
  ),
  description: z
    .string()
    .max(500)
    .optional()
    .describe("Optional free-text description of the setting."),
} satisfies z.ZodRawShape;
