import { z } from "zod";
import { BookStayUseCase } from "../../../application/use_case/property/book_stay";
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
  guests: z
    .number()
    .int()
    .positive("Guests must be greater than 0")
    .max(500, "Guests must be at most 500"),
  property_id: z.uuid(),
  entrance_code: z
    .string()
    .max(10, "Entrance code must be at most 10 characters long")
    .optional(),
  check_in: z.coerce.date(),
  check_out: z.coerce.date(),
  price: z
    .number()
    .int()
    .min(0, "Price must be a non-negative integer representing cents")
    .max(
      100_000_000,
      "Price must be at most 100000000 cents (R$ 1,000,000.00)"
    ),
  tenant: z.object({
    name: z
      .string()
      .min(2, "Name is required")
      .max(100, "Name must be at most 100 characters"),
    phone: z.string().length(13),
    sex: z.enum(["MALE", "FEMALE", "OTHER"]),
  }),
  source: z.string().max(100),
});

const outputSchema = z.object({
  message: z.string(),
  data: z.object({
    id: z.uuid(),
    guests: z.number(),
    entrance_code: z.string(),
    source: z.string(),
    tenant_id: z.uuid(),
    check_in: z.iso.datetime(),
    check_out: z.iso.datetime(),
    price: z.number().int().describe("Price in cents"),
  }),
});

type Input = z.infer<typeof inputSchema>;

export class BookStayController implements Controller {
  path = "/booking/property/:property_id/book";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Book a stay",
    description: "Creates a new stay booking for a property.",
    tags: ["Booking"],
    parameters: [
      {
        name: "property_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: bodyFromZod(inputSchema.omit({ property_id: true }), {
      example: {
        guests: 2,
        tenant: {
          name: "Gustavo teste",
          phone: "5532999865333",
          sex: "MALE",
        },
        entrance_code: "5953357",
        price: 100000,
        check_in: "2039-10-29T12:00:00-03:00",
        check_out: "2039-10-30T14:00:00-03:00",
        source: "BOOKING",
      },
    }),
    responses: {
      "200": responseFromZod("Stay created successfully", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: BookStayUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const output = await this.useCase.execute(request.body as Input, user);
    return { message: "Stay created successfully", data: output };
  }
}
