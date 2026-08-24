import { z } from "zod";
import { CancelStayUseCase } from "../../../application/use_case/stay/cancel_stay";
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

const inputSchema = z.object({
  stay_id: z.uuidv4(),
});

const outputSchema = z.object({
  id: z.uuid(),
  cancelled_at: z.iso.datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class CancelStayController implements Controller {
  path = "/booking/stay/:stay_id";
  method = HttpControllerMethod.DELETE;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Cancel stay",
    description: "Cancels an existing stay booking.",
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
      "200": responseFromZod("Stay cancelled successfully", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Stay not found"),
    },
  };

  constructor(private readonly useCase: CancelStayUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const output = await this.useCase.execute(request.body as Input, user);
    return output;
  }
}
