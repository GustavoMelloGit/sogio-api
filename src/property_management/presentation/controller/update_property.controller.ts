import z from "zod";
import type { UpdatePropertyUseCase } from "../../application/use_case/update_property";
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
import { updatePropertyInput } from "../schema/update_property.schema";

const inputSchema = z.object(updatePropertyInput);

const addressSchema = z.object({
  street: z.string().min(1).max(100, "Street must be at most 100 characters"),
  number: z.string().min(1).max(20, "Number must be at most 20 characters"),
  neighborhood: z
    .string()
    .min(1)
    .max(100, "Neighborhood must be at most 100 characters"),
  city: z.string().min(1).max(100, "City must be at most 100 characters"),
  state: z.string().min(1).max(100, "State must be at most 100 characters"),
  zip_code: z.string().min(1).max(20, "Zip code must be at most 20 characters"),
  country: z.string().min(1).max(100, "Country must be at most 100 characters"),
  complement: z
    .string()
    .max(100, "Complement must be at most 100 characters")
    .default(""),
});

const outputSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  user_id: z.uuid(),
  address: addressSchema,
  images: z.array(z.string()),
  capacity: z.number().int(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class UpdatePropertyController implements Controller {
  path = "/property/:property_id";
  method = HttpControllerMethod.PATCH;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Update property",
    description: "Updates name, address, images or capacity of a property.",
    tags: ["Properties"],
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
        name: "Apartamento Vista Mar - Reformado",
        capacity: 5,
      },
    }),
    responses: {
      "200": responseFromZod("Updated property", outputSchema),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Property not found"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: UpdatePropertyUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    const output = await this.useCase.execute(
      {
        property_id: input.property_id,
        update_data: {
          name: input.name,
          address: input.address,
          images: input.images,
          capacity: input.capacity,
        },
      },
      user
    );

    return output;
  }
}
