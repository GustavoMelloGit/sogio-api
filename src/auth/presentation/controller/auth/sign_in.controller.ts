import z from "zod";
import type { SignInUseCase } from "../../../../auth/application/use_case/sign_in";
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
  email: z.email().max(255, "Email must be at most 255 characters"),
  password: z.string().max(128, "Password must be at most 128 characters"),
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

export class SignInController implements Controller {
  path = "/auth/sign-in";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Sign in",
    description:
      "Authenticates a user with email and password, returning a JWT token.",
    tags: ["Auth"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        email: "gustavo@stayhub.com",
        password: "SenhaForte123",
      },
    }),
    responses: {
      "200": responseFromZod("Successfully authenticated", outputSchema),
      "401": errorResponse("Invalid credentials"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: SignInUseCase) {}

  async handle(request: ControllerRequest) {
    const output = await this.useCase.execute(request.body as Input);
    return output;
  }
}
