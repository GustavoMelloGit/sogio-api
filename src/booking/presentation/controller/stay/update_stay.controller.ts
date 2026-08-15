import { z } from "zod";
import { UpdateStayUseCase } from "../../../application/use_case/stay/update_stay";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { User } from "../../../../auth/domain/entity/user";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object({
  stay_id: z.uuid(),
  check_in: z.coerce.date().optional(),
  check_out: z.coerce.date().optional(),
  guests: z
    .int()
    .positive("Guests must be greater than 0")
    .max(500, "Guests must be at most 500")
    .optional(),
  price: z
    .int()
    .positive("Price must be greater than 0")
    .max(100_000_000, "Price must be at most 100000000 cents (R$ 1,000,000.00)")
    .optional(),
});

const outputSchema = z.object({
  id: z.string().uuid(),
  check_in: z.string().datetime(),
  check_out: z.string().datetime(),
  guests: z.number().int(),
  entrance_code: z.string(),
  price: z.number().int().describe("Price in cents"),
  updated_at: z.string().datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class UpdateStayController implements Controller {
  path = "/booking/stay/:stay_id";
  method = HttpControllerMethod.PATCH;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Update stay",
    description: "Updates check-in/check-out dates, guests or price of a stay.",
    tags: ["Stays"],
    parameters: [
      {
        name: "stay_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: bodyFromZod(inputSchema.omit({ stay_id: true }), {
      example: {
        check_in: "2039-10-29T12:00:00-03:00",
        check_out: "2039-10-30T14:00:00-03:00",
        guests: 3,
        price: 120000,
      },
    }),
    responses: {
      "200": responseFromZod("Updated stay", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Stay not found"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: UpdateStayUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const output = await this.useCase.execute(request.body as Input, user);
    return output;
  }
}
