import { z } from "zod";
import {
  SUPPORTED_LOCALES,
  localeSchema,
  timeZoneSchema,
} from "../../../core/domain/locale/locale";
import type { InputRule } from "../../../core/presentation/schema/input_rule";

export const updateUserPreferencesInput = {
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
} satisfies z.ZodRawShape;

export const atLeastOnePreferenceRule: InputRule<{
  locale?: string;
  time_zone?: string;
}> = {
  message: "At least one preference must be provided",
  path: [],
  isSatisfiedBy: input =>
    input.locale !== undefined || input.time_zone !== undefined,
};
