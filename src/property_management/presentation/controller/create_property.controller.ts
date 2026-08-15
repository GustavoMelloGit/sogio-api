import z from "zod";
import type { CreatePropertyUseCase } from "../../application/use_case/create_property";
import type { User } from "../../../auth/domain/entity/user";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../core/infra/http/swagger/schema_helpers";

const addressSchema = z.object({
  street: z
    .string()
    .min(1, "Street is required")
    .max(100, "Street must be at most 100 characters"),
  number: z
    .string()
    .min(1, "Number is required")
    .max(20, "Number must be at most 20 characters"),
  neighborhood: z
    .string()
    .min(1, "Neighborhood is required")
    .max(100, "Neighborhood must be at most 100 characters"),
  city: z
    .string()
    .min(1, "City is required")
    .max(100, "City must be at most 100 characters"),
  state: z
    .string()
    .min(1, "State is required")
    .max(100, "State must be at most 100 characters"),
  zip_code: z
    .string()
    .min(1, "Zip code is required")
    .max(20, "Zip code must be at most 20 characters"),
  country: z
    .string()
    .min(1, "Country is required")
    .max(100, "Country must be at most 100 characters"),
  complement: z
    .string()
    .max(100, "Complement must be at most 100 characters")
    .default(""),
});

const inputSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  address: addressSchema,
  images: z
    .array(z.string().max(2048, "Image URL must be at most 2048 characters"))
    .min(1, "At least one image is required"),
  capacity: z
    .number()
    .int()
    .positive("Capacity must be greater than 0")
    .max(500, "Capacity must be at most 500"),
});

const outputSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  user_id: z.string().uuid(),
  address: addressSchema,
  images: z.array(z.string()),
  capacity: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class CreatePropertyController implements Controller {
  path = "/property";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Create property",
    description: "Creates a new property owned by the authenticated user.",
    tags: ["Properties"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        name: "Apartamento Vista Mar",
        address: {
          street: "Avenida Beira Mar",
          number: "1200",
          neighborhood: "Praia do Canto",
          city: "Vitória",
          state: "ES",
          zip_code: "29055-000",
          country: "Brasil",
          complement: "Apto 302",
        },
        images: ["https://cdn.sogio.com/properties/vista-mar/1.jpg"],
        capacity: 4,
      },
    }),
    responses: {
      "200": responseFromZod("Property created", outputSchema),
      "401": errorResponse("Unauthorized"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: CreatePropertyUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    const output = await this.useCase.execute({
      name: input.name,
      user_id: user.id,
      address: input.address,
      images: input.images,
      capacity: input.capacity,
    });

    return output;
  }
}
