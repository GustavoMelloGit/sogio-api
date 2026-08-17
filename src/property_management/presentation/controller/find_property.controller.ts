import z from "zod";
import type { User } from "../../../auth/domain/entity/user";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { FindPropertyUseCase } from "../../application/use_case/find_property";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object({
  property_id: z.uuid(),
});

const outputSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  capacity: z.number().int(),
  images: z.array(z.string()),
  address: z.object({
    street: z.string(),
    number: z.string(),
    neighborhood: z.string(),
    city: z.string(),
    state: z.string(),
    zip_code: z.string(),
    country: z.string(),
    complement: z.string(),
  }),
  user_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class FindPropertyController implements Controller {
  path = "/property/:property_id";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Find property",
    description:
      "Returns details of a specific property owned by the authenticated user.",
    tags: ["Properties"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "200": responseFromZod("Property details", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
    },
  };

  constructor(private readonly useCase: FindPropertyUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    const output = await this.useCase.execute(
      { property_id: input.property_id },
      user
    );

    return output;
  }
}
