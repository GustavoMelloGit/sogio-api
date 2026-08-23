import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { User } from "../../../domain/entity/user";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";

const outputSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  locale: z.string(),
  time_zone: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export class GetUserController implements Controller {
  path = "/auth/me";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "Get current user",
    description: "Returns the profile of the authenticated user.",
    tags: ["Auth"],
    responses: {
      "200": responseFromZod("Current user profile", outputSchema),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor() {}

  async handle(_request: ControllerRequest, user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      time_zone: user.time_zone,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
}
