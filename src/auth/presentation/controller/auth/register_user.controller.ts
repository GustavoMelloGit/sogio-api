import z from "zod";
import type { RegisterUserUseCase } from "../../../../auth/application/use_case/register_user";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object({
  name: z.string().min(3).max(100, "Name must be at most 100 characters"),
  email: z.email().max(255, "Email must be at most 255 characters"),
  password: z
    .string()
    .min(8)
    .max(128, "Password must be at most 128 characters"),
});

const outputSchema = z.object({
  token: z.string().describe("JWT bearer token"),
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    role: z.enum(["user", "admin"]),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  }),
});

type Input = z.infer<typeof inputSchema>;

export class RegisterUserController implements Controller {
  path = "/auth/users";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Register user",
    description: "Creates a new user account and returns a JWT token.",
    tags: ["Auth"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        name: "Gustavo Marques",
        email: "gustavo@stayhub.com",
        password: "SenhaForte123",
      },
    }),
    responses: {
      "200": responseFromZod("User registered successfully", outputSchema),
      "409": errorResponse("User already exists"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: RegisterUserUseCase) {}

  async handle(request: ControllerRequest) {
    const output = await this.useCase.execute(request.body as Input);
    return output;
  }
}
