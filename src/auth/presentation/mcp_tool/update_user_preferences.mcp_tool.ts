import {
  SUPPORTED_LOCALES,
  localeSchema,
  timeZoneSchema,
} from "../../../core/domain/locale/locale";
import type { UpdateUserPreferencesUseCase } from "../../application/use_case/update_user_preferences";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { ValidationError } from "../../../core/application/error/validation_error";

export const inputSchema = {
  locale: localeSchema
    .optional()
    .describe(
      `Language used to render content addressed to the user. One of: ${SUPPORTED_LOCALES.join(", ")}. Omit to keep the current one.`
    ),
  time_zone: timeZoneSchema
    .optional()
    .describe(
      "IANA time zone used to render dates addressed to the user, e.g. America/Sao_Paulo or Europe/Lisbon. Omit to keep the current one."
    ),
};

export function makeUpdateUserPreferencesTool(
  useCase: UpdateUserPreferencesUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "update_user_preferences",
    description:
      "Changes the language and/or time zone used to render content addressed to the authenticated user. Call get_user_preferences first to learn the supported languages. Takes effect on notifications that have not been delivered yet.",
    inputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
    handler: async (input, user) => {
      if (input.locale === undefined && input.time_zone === undefined) {
        throw new ValidationError("At least one preference must be provided");
      }

      return useCase.execute(input, user);
    },
  };
}
