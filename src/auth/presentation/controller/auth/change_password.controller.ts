import z from "zod";
import type { ChangePasswordUseCase } from "../../../application/use_case/change_password";
import { passwordSchema } from "../../../domain/entity/user";
import type { User } from "../../../domain/entity/user";
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
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

type Input = z.infer<typeof inputSchema>;

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 20,
};

export class ChangePasswordController implements Controller {
  path = "/auth/change-password";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Change password",
    description:
      "Changes the authenticated user's password, requiring the current password.",
    tags: ["Auth"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        currentPassword: "SenhaAntiga123",
        newPassword: "SenhaNova456",
      },
    }),
    responses: {
      "204": noContentResponse("Password changed successfully"),
      "401": errorResponse("Incorrect current password"),
      "422": validationErrorResponse(),
    },
  };

  constructor(private readonly useCase: ChangePasswordUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<undefined> {
    await this.useCase.execute(request.body as Input, user);
    return undefined;
  }
}
