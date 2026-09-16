import { z } from "zod";
import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";
import type { AuthMiddleware } from "../../middleware/auth.middleware";
import type {
  GetPendingAuthorizationRequestResult,
  GetPendingAuthorizationRequestUseCase,
} from "../../../application/use_case/get_pending_authorization_request";
import { oauthProtocolError } from "./oauth_error_response";
import { parseUniqueQueryParams } from "./unique_query_params";

const outputSchema = z.object({
  app_display_name: z.string(),
  app_display_name_verified: z.literal(false),
  redirect_host: z.string(),
  scope_description: z.string(),
  has_existing_consent: z.boolean(),
  can_connect: z.boolean(),
});

/**
 * Query parameter carrying the opaque pending-request identifier. Shared
 * (same literal name) with `DecideAuthorizationRequestController`'s JSON
 * body field, so the front never renames anything between the consult and
 * the decision call.
 */
export const PENDING_REQUEST_ID_PARAM = "request_id";

/**
 * `GET /connect/authorize/pending-request` — contract step 4 (task 10).
 * Reads exclusively from the query string (E1-style discipline, even
 * though this isn't one of the four endpoints E1's table names): a
 * duplicated key fails closed before anything else runs, via the same
 * `parseUniqueQueryParams` `/authorize` uses, rather than the adapter's
 * own already-deduplicated `request.query`.
 *
 * Public by necessity — the plan's contract has the front consult this
 * *before* the user has necessarily logged in — but never blind to an
 * identified caller: `AuthMiddleware.handleOptional` resolves a user from
 * whatever session the front happens to already have, without ever failing
 * the request when there isn't one. That is
 * the only way `has_existing_consent` can be computed for the reconnection
 * shortcut without either (a) requiring login before this call, which the
 * contract doesn't do, or (b) leaking whether *some* user has consented,
 * which this never does — the flag only ever answers for the one caller
 * this request identified, defaulting to `false` when none was.
 *
 * The response carries nothing sensitive and no OAuth parameter: no
 * `redirect_uri`, `code_challenge`, `state`, or raw `client_id`. A
 * request that's missing, expired, or already consumed is Mode A (E2) —
 * a generic "not found", with no redirect data of any kind.
 */
export class GetPendingAuthorizationRequestController implements Controller {
  path = "/connect/authorize/pending-request";
  method = HttpControllerMethod.GET;
  parameterSource = "query" as const;

  openApiSpec: OpenApiOperation = {
    summary: "Get pending authorization request",
    description:
      "Display-only lookup of a Pending Authorization Request, for the OAuth consent screen. `can_connect` tells the caller identified by whatever session it presents (optional — this is reachable before login) whether it can consent to the connection right now: true when it has platform access and its plan includes AI assistant access, true for an admin, and false both when the plan doesn't include it and when no caller is identified.",
    tags: ["Auth"],
    responses: {
      "200": responseFromZod("Pending authorization request", outputSchema, {
        app_display_name: "Example App",
        app_display_name_verified: false,
        redirect_host: "example.com",
        scope_description: "Read and manage your Sogio account",
        has_existing_consent: false,
        can_connect: true,
      }),
      "404": errorResponse("Not found"),
    },
  };

  constructor(
    private readonly useCase: GetPendingAuthorizationRequestUseCase,
    private readonly authMiddleware: AuthMiddleware
  ) {}

  async handle(request: ControllerRequest): Promise<ControllerHttpResponse> {
    const params = parseUniqueQueryParams(request.url);
    if (!params) {
      return oauthProtocolError(
        400,
        "invalid_request",
        "The request contains a duplicated parameter."
      );
    }

    const identifier = params[PENDING_REQUEST_ID_PARAM];
    if (!identifier) {
      return oauthProtocolError(
        400,
        "invalid_request",
        "request_id is required."
      );
    }

    const user = await this.authMiddleware.handleOptional(request, true);

    const result = await this.useCase.execute({
      identifier,
      userId: user?.id,
      userRole: user?.role,
    });

    return this.#respond(result);
  }

  #respond(
    result: GetPendingAuthorizationRequestResult
  ): ControllerHttpResponse {
    if (!result.found) {
      return oauthProtocolError(
        404,
        "request_not_found",
        "The authorization request does not exist, has expired, or was already used."
      );
    }

    return new ControllerHttpResponse({
      status: 200,
      cache: "no-store",
      body: {
        app_display_name: result.appDisplayName,
        app_display_name_verified: result.appDisplayNameVerified,
        redirect_host: result.redirectHost,
        scope_description: result.scopeDescription,
        has_existing_consent: result.hasExistingConsent,
        can_connect: result.canConnect,
      },
    });
  }
}
