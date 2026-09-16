import z from "zod";
import type { RegisterUserUseCase } from "../../../../auth/application/use_case/register_user";
import { passwordSchema } from "../../../domain/entity/user";
import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import { buildSessionCookie } from "../../http/session_cookie";
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
  password: passwordSchema,
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

export class RegisterUserController implements Controller {
  path = "/auth/users";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Register user",
    description:
      "Creates a new user account, sets the session cookie and returns the session secret.",
    tags: ["Auth"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        name: "Gustavo Marques",
        email: "gustavo@sogio.com",
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

    // O navegador recebe a sessão no cookie httpOnly e nunca toca no segredo;
    // o corpo continua trazendo o token para quem chama a API direto.
    return new ControllerHttpResponse({
      status: 200,
      body: output,
      headers: { "Set-Cookie": buildSessionCookie(output.token) },
      // A resposta carrega o segredo no corpo e no `Set-Cookie` (E8).
      cache: "no-store",
    });
  }
}
