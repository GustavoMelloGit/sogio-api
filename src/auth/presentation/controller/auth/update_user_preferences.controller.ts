import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { User } from "../../../domain/entity/user";
import type { UpdateUserPreferencesUseCase } from "../../../application/use_case/update_user_preferences";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";
import { localeSchema } from "../../../../core/domain/locale/locale";
import {
  atLeastOnePreferenceRule,
  updateUserPreferencesInput,
} from "../../schema/update_user_preferences.schema";
import { withRules } from "../../../../core/presentation/schema/input_rule";

const inputSchema = withRules(
  z.object(updateUserPreferencesInput),
  atLeastOnePreferenceRule
);

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  locale: localeSchema,
  time_zone: z.string(),
});

export class UpdateUserPreferencesController implements Controller {
  path = "/auth/me/preferences";
  method = HttpControllerMethod.PATCH;
  inputSchema = inputSchema;
  parameterSource = "json" as const;

  openApiSpec: OpenApiOperation = {
    summary: "Update display preferences",
    description:
      "Updates the language and/or time zone used to render content addressed to the authenticated user.",
    tags: ["Auth"],
    requestBody: bodyFromZod(inputSchema, {
      example: { locale: "en-US", time_zone: "Europe/Lisbon" },
    }),
    responses: {
      "200": responseFromZod("Updated display preferences", outputSchema),
      "401": errorResponse("Unauthorized"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: UpdateUserPreferencesUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    return this.useCase.execute(request.body as Input, user);
  }
}
