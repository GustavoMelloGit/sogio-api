import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { User } from "../../../domain/entity/user";
import type { GetUserPreferencesUseCase } from "../../../application/use_case/get_user_preferences";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";
import { SUPPORTED_LOCALES } from "../../../../core/domain/locale/locale";

const outputSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES),
  time_zone: z.string(),
  supported_locales: z.array(z.enum(SUPPORTED_LOCALES)),
});

export class GetUserPreferencesController implements Controller {
  path = "/auth/me/preferences";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "Get display preferences",
    description:
      "Returns the language and time zone used to render content addressed to the authenticated user.",
    tags: ["Auth"],
    responses: {
      "200": responseFromZod("Current display preferences", outputSchema),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: GetUserPreferencesUseCase) {}

  async handle(_request: ControllerRequest, user: User) {
    return this.useCase.execute(undefined, user);
  }
}
