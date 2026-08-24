import z from "zod";
import { ListTenantsUseCase } from "../../../application/use_case/tenant/list_tenents";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";
import type { User } from "../../../../auth/domain/entity/user";

const outputSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string(),
    sex: z.enum(["MALE", "FEMALE", "OTHER"]),
  })
);

export class ListTenantsController implements Controller {
  path = "/tenants";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "List tenants",
    description:
      "Returns tenants who have stays in properties owned by the authenticated user.",
    tags: ["Tenants"],
    parameters: [
      {
        name: "q",
        in: "query",
        required: false,
        description: "Filter tenants by name (case-insensitive, partial match)",
        schema: { type: "string" },
      },
    ],
    responses: {
      "200": responseFromZod("List of tenants", outputSchema),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: ListTenantsUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const tenants = await this.useCase.execute(
      { query: request.query.q },
      user
    );
    return tenants;
  }
}
