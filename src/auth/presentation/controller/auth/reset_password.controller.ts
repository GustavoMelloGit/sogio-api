import z from "zod";
import type { ResetPasswordUseCase } from "../../../application/use_case/reset_password";
import { passwordSchema } from "../../../domain/entity/user";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../../core/application/rate_limit/rate_limit_policy";
import {
  bodyFromZod,
  errorResponse,
  noContentResponse,
  validationErrorResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: passwordSchema,
});

type Input = z.infer<typeof inputSchema>;

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 10,
};

/**
 * Pública. Token e nova senha viajam **apenas no corpo** (R9) — nunca em
 * query string ou path, que vazam para logs de acesso, referrers e proxies.
 * `parameterSource: "json"` garante que o adaptador valida exclusivamente o
 * corpo, ignorando qualquer valor colado na query string.
 */
export class ResetPasswordController implements Controller {
  path = "/auth/password-reset/confirm";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;
  parameterSource = "json" as const;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Reset password",
    description:
      "Consumes a password reset token and sets a new password. The token and new password are always read from the JSON body.",
    tags: ["Auth"],
    requestBody: bodyFromZod(inputSchema, {
      example: { token: "opaque-reset-token", newPassword: "SenhaNova456" },
    }),
    responses: {
      "204": noContentResponse("Password reset successfully"),
      "401": errorResponse("Invalid or expired password reset token"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: ResetPasswordUseCase) {}

  async handle(request: ControllerRequest): Promise<undefined> {
    await this.useCase.execute(request.body as Input);
    return undefined;
  }
}
