import { z } from "zod";
import { GetStayUseCase } from "../../../application/use_case/stay/get_stay";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { User } from "../../../../auth/domain/entity/user";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";
import { getStayInput } from "../../schema/get_stay.schema";

const inputSchema = z.object(getStayInput);

const outputSchema = z.object({
  id: z.uuid(),
  check_in: z.iso.datetime(),
  check_out: z.iso.datetime(),
  guests: z.number().int(),
  entrance_code: z.string(),
  price: z.number().int().describe("Price in cents"),
  source: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  tenant: z.object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string(),
    sex: z.enum(["MALE", "FEMALE", "OTHER"]),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }),
});

type Input = z.infer<typeof inputSchema>;

export class GetStayController implements Controller {
  path = "/booking/stay/:stay_id";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Get stay",
    description: "Returns full stay details including tenant information.",
    tags: ["Stays"],
    parameters: [
      {
        name: "stay_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "200": responseFromZod("Stay details", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Stay not found"),
    },
  };

  constructor(private readonly useCase: GetStayUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const output = await this.useCase.execute(request.body as Input, user);
    return output;
  }
}
