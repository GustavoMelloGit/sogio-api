import z from "zod";
import type { RequestPasswordResetUseCase } from "../../../application/use_case/request_password_reset";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../../core/application/rate_limit/rate_limit_policy";
import {
  bodyFromZod,
  responseFromZod,
  validationErrorResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object({
  email: z.email().max(255, "Email must be at most 255 characters"),
});

const outputSchema = z.object({
  message: z.string(),
});

type Input = z.infer<typeof inputSchema>;

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 10,
};

/**
 * Pública. A resposta é sempre a mesma (D11) — ver `RequestPasswordResetUseCase`.
 */
export class RequestPasswordResetController implements Controller {
  path = "/auth/password-reset/request";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;
  parameterSource = "json" as const;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Request password reset",
    description:
      "Requests a password reset link by email. Always responds the same way, regardless of whether the email exists.",
    tags: ["Auth"],
    requestBody: bodyFromZod(inputSchema, {
      example: { email: "gustavo@sogio.com" },
    }),
    responses: {
      "200": responseFromZod("Request accepted", outputSchema),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: RequestPasswordResetUseCase) {}

  async handle(request: ControllerRequest) {
    const output = await this.useCase.execute(request.body as Input);
    return output;
  }
}
