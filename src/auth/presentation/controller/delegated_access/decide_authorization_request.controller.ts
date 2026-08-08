import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { Logger } from "../../../../core/application/logger/logger";
import type { User } from "../../../domain/entity/user";
import type {
  AuthorizationDecision,
  DecideAuthorizationRequestResult,
  DecideAuthorizationRequestUseCase,
} from "../../../application/use_case/decide_authorization_request";
import { oauthProtocolError } from "./oauth_error_response";
import { PENDING_REQUEST_ID_PARAM } from "./get_pending_authorization_request.controller";

const VALID_DECISIONS: readonly AuthorizationDecision[] = ["approve", "deny"];

/**
 * `POST /connect/authorize/decision` — contract step 6 (task 10), and the
 * same endpoint the reconnection shortcut calls silently (no separate
 * endpoint for it — the plan's contract only skips *showing* the consent
 * UI, not the call itself).
 *
 * Authenticated by the app's own session (JWT Bearer, `authenticated:
 * true` in routes.ts) — never by any OAuth parameter. The user consenting
 * is whoever is logged in *right now*, resolved the same way every other
 * authenticated route in this API resolves it.
 *
 * Reads exclusively from the JSON body (E1-style discipline): both fields
 * are hand-validated here, the same way `RegisterAppController` and
 * `AuthorizeController` validate their own inputs, so a malformed request
 * answers with this route's own fixed OAuth-shaped error rather than the
 * API's default `{ message }`/Zod-detail shape (E7 — this endpoint carries
 * the pending-request's bearer identifier, which must never be echoed
 * back in any form).
 *
 * A request that's missing, expired, or already consumed by the time this
 * runs is Mode A (E2): a "not found" answer with no redirect data at all
 * — never a stale or replayed destination. Otherwise this always responds
 * 200 with the single destination URL the use case built from the
 * *registered* redirect URI; the front's only job is to navigate to it.
 */
export class DecideAuthorizationRequestController implements Controller {
  path = "/connect/authorize/decision";
  method = HttpControllerMethod.POST;
  parameterSource = "json" as const;

  constructor(
    private readonly useCase: DecideAuthorizationRequestUseCase,
    private readonly logger: Logger
  ) {}

  async handle(
    request: ControllerRequest,
    user: User
  ): Promise<ControllerHttpResponse> {
    const identifier = request.body[PENDING_REQUEST_ID_PARAM];
    if (typeof identifier !== "string" || identifier.length === 0) {
      return oauthProtocolError(
        400,
        "invalid_request",
        "request_id is required."
      );
    }

    const decision = request.body.decision;
    if (
      typeof decision !== "string" ||
      !VALID_DECISIONS.includes(decision as AuthorizationDecision)
    ) {
      return oauthProtocolError(
        400,
        "invalid_request",
        'decision must be either "approve" or "deny".'
      );
    }

    const result = await this.useCase.execute(
      { identifier, decision: decision as AuthorizationDecision },
      user
    );

    return this.#respond(result);
  }

  #respond(result: DecideAuthorizationRequestResult): ControllerHttpResponse {
    if (result.outcome === "not_found") {
      this.#log("not_found", undefined);
      return oauthProtocolError(
        404,
        "request_not_found",
        "The authorization request does not exist, has expired, or was already used."
      );
    }

    this.#log(result.decision, result.clientId, result.location);
    return new ControllerHttpResponse({
      status: 200,
      cache: "no-store",
      body: { redirect_to: result.location },
    });
  }

  /**
   * E7's allowlist: endpoint name, outcome, `client_id`, and only the
   * *host* of the destination the front will navigate to — never the full
   * URL, which for an approval carries the authorization code and for a
   * denial carries `error_description` in its query string.
   */
  #log(
    result: "approve" | "deny" | "not_found",
    clientId: string | undefined,
    redirectLocation?: string
  ): void {
    const context: Record<string, unknown> = {
      endpoint: "authorize_decision",
      result,
      client_id: clientId,
    };

    if (redirectLocation) {
      context.redirect_host = new URL(redirectLocation).host;
    }

    if (result === "not_found") {
      this.logger.warn("authorize_decision", context);
    } else {
      this.logger.info("authorize_decision", context);
    }
  }
}
