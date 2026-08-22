import { z } from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  noContentResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";
import type { User } from "../../../domain/entity/user";
import type { RevokeConsentUseCase } from "../../../application/use_case/revoke_consent";

const inputSchema = z
  .object({
    consentId: z.uuidv4("consentId must be a valid UUID"),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

/**
 * `DELETE /auth/connected-apps/:consentId` — "desconectar" (task 14).
 * Authenticated the same way as `ListConnectedAppsController` (the app's
 * own session, never the OAuth credential).
 *
 * Ownership — "só os aplicativos do próprio usuário" — is enforced inside
 * `RevokeConsentUseCase` (task 12), not here: a `consentId` belonging to
 * another user answers `ResourceNotFoundError` (404), the same
 * not-found/not-yours convention `UpdatePropertyUseCase`/`CancelStayUseCase`
 * already use. This controller never reimplements that check or the
 * revocation cascade — both already exist in `RevokeConsentUseCase`, which
 * in turn delegates the cascade itself to `revokeConsentCascade`.
 *
 * Effect is immediate: the next call the disconnected app makes to `/mcp`
 * is rejected with `401` by `OAuthCredentialVerifier`, which checks
 * `revoked_at` on both the credential and its Consent.
 */
export class DisconnectAppController implements Controller {
  path = "/auth/connected-apps/:consentId";
  method = HttpControllerMethod.DELETE;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Disconnect app",
    description:
      "Revokes the Consent identified by consentId and, in cascade, every credential derived from it. The next call the app makes to /mcp receives 401.",
    tags: ["Auth"],
    parameters: [
      {
        name: "consentId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "204": noContentResponse("App disconnected"),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse("Consent not found"),
    },
  };

  constructor(private readonly useCase: RevokeConsentUseCase) {}

  async handle(request: ControllerRequest, user: User): Promise<undefined> {
    const input = request.body as Input;

    await this.useCase.execute({ consentId: input.consentId }, user);
    return undefined;
  }
}
