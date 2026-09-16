import z from "zod";
import type { SignInUseCase } from "../../../../auth/application/use_case/sign_in";
import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import { buildSessionCookie } from "../../http/session_cookie";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../../core/application/rate_limit/rate_limit_policy";
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
  token: z
    .string()
    .describe(
      "Segredo da sessão. Também vai no cookie httpOnly desta resposta; o corpo o repete para quem chama a API fora do navegador."
    ),
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.email(),
    role: z.enum(["user", "admin"]),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }),
});

type Input = z.infer<typeof inputSchema>;

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 20,
};

export class SignInController implements Controller {
  path = "/auth/sign-in";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Sign in",
    description:
      "Authenticates a user with email and password, setting the session cookie and returning the session secret.",
    tags: ["Auth"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        email: "gustavo@sogio.com",
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

    return new ControllerHttpResponse({
      status: 200,
      body: output,
      headers: { "Set-Cookie": buildSessionCookie(output.token) },
      cache: "no-store",
    });
  }
}
