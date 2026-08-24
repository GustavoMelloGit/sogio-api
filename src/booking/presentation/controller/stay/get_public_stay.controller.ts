import z from "zod";
import type { GetPublicStayUseCase } from "../../../application/use_case/stay/get_public_stay";
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

const inputSchema = z.object({
  stay_id: z.uuid(),
});

const outputSchema = z.object({
  check_in: z.iso.datetime(),
  check_out: z.iso.datetime(),
  entrance_code: z.string(),
  tenant: z.object({
    name: z.string(),
  }),
});

type Input = z.infer<typeof inputSchema>;

export class GetPublicStayController implements Controller {
  path = "/public/booking/stay/:stay_id";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Get public stay",
    description: "Returns publicly accessible stay information by ID.",
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
      "200": responseFromZod("Stay public details", outputSchema),
      "404": errorResponse("Stay not found"),
    },
  };

  constructor(private readonly useCase: GetPublicStayUseCase) {}

  async handle(request: ControllerRequest) {
    const output = await this.useCase.execute(request.body as Input);
    return output;
  }
}
