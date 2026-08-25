import z from "zod";
import type { User } from "../../../auth/domain/entity/user";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { FindUserPropertiesUseCase } from "../../application/use_case/find_user_properties";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const outputSchema = z.object({
  properties: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
    })
  ),
});

export class FindUserPropertiesController implements Controller {
  path = "/property/user/all";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "Find user properties",
    description: "Returns all properties owned by the authenticated user.",
    tags: ["Properties"],
    responses: {
      "200": responseFromZod("List of user properties", outputSchema),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: FindUserPropertiesUseCase) {}

  async handle(_request: ControllerRequest, user: User) {
    const output = await this.useCase.execute({ user_id: user.id });
    return output;
  }
}
