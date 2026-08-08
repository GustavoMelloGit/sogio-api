import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { RateLimitPolicy } from "../../../../core/application/rate_limit/rate_limit_policy";
import type { Logger } from "../../../../core/application/logger/logger";
import {
  apiBaseUrl,
  frontBaseUrl,
} from "../../../../core/infra/config/environments";
import type {
  InitiateAuthorizationResult,
  InitiateAuthorizationUseCase,
} from "../../../application/use_case/initiate_authorization";
import { MCP_RESOURCE_PATH } from "./oauth_protected_resource_metadata.controller";
import { OAUTH_AUTHORIZATION_ENDPOINT_PATH } from "./oauth_authorization_server_metadata.controller";
import { renderAuthorizeErrorPage } from "./oauth_authorize_error_page";

/**
 * Path and query parameter the front's consent page is reached at. Owned
 * here, next to the only place that builds this redirect, and exported so
 * task 10's "pending request" controllers on this side (if any) and the
 * `stayhub-front` implementation agree on the same contract: the front
 * receives nothing but this opaque identifier — no OAuth parameter ever
 * reaches it.
 */
export const FRONT_CONSENT_PATH = "/connect/authorize";
export const FRONT_CONSENT_REQUEST_ID_PARAM = "request_id";

/**
 * Per-IP limit on `/authorize` (E2 step 0, E5). Unauthenticated by
 * necessity — the whole point of this endpoint is that the caller isn't
 * authenticated yet — so the peer IP is the only identity available.
 */
const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 20,
};

/**
 * `GET /authorize` — the start of the authorization flow (task 9). Reads
 * exclusively from the raw query string (E1): `request.query`, as parsed by
 * the adapter, has already silently collapsed any duplicate key, which is
 * exactly the ambiguity E1 exists to reject, so this controller re-derives
 * the params itself from `request.url` and fails closed on a duplicate
 * before anything else runs.
 *
 * Implements E2's two error modes on top of `InitiateAuthorizationUseCase`,
 * which owns the ordered validation (steps 2-11) and returns a structured
 * result rather than throwing — nothing in this route ever raises a
 * `ValidationError` or goes through the adapter's default JSON error path,
 * so the OAuth error shape and E7's logging allowlist are the only things
 * that ever describe a failure here.
 */
export class AuthorizeController implements Controller {
  path = OAUTH_AUTHORIZATION_ENDPOINT_PATH;
  method = HttpControllerMethod.GET;
  parameterSource = "query" as const;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  constructor(
    private readonly useCase: InitiateAuthorizationUseCase,
    private readonly logger: Logger
  ) {}

  async handle(request: ControllerRequest): Promise<ControllerHttpResponse> {
    const params = this.#parseUniqueQueryParams(request.url);

    if (!params) {
      this.#log("error", undefined, "invalid_request", request.peerIp);
      return this.#modeAResponse(
        "The request contains a duplicated parameter."
      );
    }

    const result = await this.useCase.execute({
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      response_type: params.response_type,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
      scope: params.scope,
      resource: params.resource,
      state: params.state,
      expectedResource: `${apiBaseUrl}${MCP_RESOURCE_PATH}`,
    });

    return this.#respond(result, params.client_id, request.peerIp);
  }

  #respond(
    result: InitiateAuthorizationResult,
    clientId: string | undefined,
    peerIp: string | null
  ): ControllerHttpResponse {
    if (result.mode === "A") {
      this.#log("error", clientId, result.error, peerIp);
      return this.#modeAResponse(result.errorDescription);
    }

    if (result.mode === "B") {
      const location = this.#buildClientErrorRedirect(result);
      this.#log("error", clientId, result.error, peerIp, location);
      return this.#redirect(location);
    }

    const location = this.#buildFrontConsentUrl(result.requestIdentifier);
    this.#log("success", clientId, undefined, peerIp, location);
    return this.#redirect(location);
  }

  #buildClientErrorRedirect(result: {
    redirectUri: string;
    state: string | undefined;
    error: string;
    errorDescription: string;
  }): string {
    const url = new URL(result.redirectUri);
    url.searchParams.set("error", result.error);
    url.searchParams.set("error_description", result.errorDescription);
    if (result.state !== undefined) {
      url.searchParams.set("state", result.state);
    }
    return url.toString();
  }

  #buildFrontConsentUrl(requestIdentifier: string): string {
    const url = new URL(`${frontBaseUrl}${FRONT_CONSENT_PATH}`);
    url.searchParams.set(FRONT_CONSENT_REQUEST_ID_PARAM, requestIdentifier);
    return url.toString();
  }

  #modeAResponse(reason: string): ControllerHttpResponse {
    return new ControllerHttpResponse({
      status: 400,
      cache: "no-store",
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: renderAuthorizeErrorPage(reason),
    });
  }

  #redirect(location: string): ControllerHttpResponse {
    return new ControllerHttpResponse({
      status: 302,
      cache: "no-store",
      headers: { Location: location },
    });
  }

  /**
   * E1: inspects every occurrence of every key in the raw query string and
   * fails (returns `null`) the moment one repeats, before any semantic
   * validation. Deliberately independent of the adapter's own
   * `ControllerRequest.query` / `resolveValidationInput`, which only runs
   * this check when a controller declares `inputSchema` — protocol routes
   * don't (see `register_app.controller.ts`), since a `ValidationError`
   * from that pipeline would answer with the API's default `{ message }`
   * shape and status, not the OAuth error shape this route requires.
   */
  #parseUniqueQueryParams(url: string): Record<string, string> | null {
    let searchParams: URLSearchParams;
    try {
      searchParams = new URL(url).searchParams;
    } catch {
      return null;
    }

    const seen = new Set<string>();
    const params: Record<string, string> = {};

    for (const [key, value] of searchParams.entries()) {
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
      params[key] = value;
    }

    return params;
  }

  /**
   * E7's allowlist, and nothing else: endpoint name, OAuth error code,
   * `client_id`, outcome, the rate limit key (the peer IP — see E5), and
   * only the *host* of wherever the browser is being sent, never the full
   * URL (which for a Mode B failure carries `error_description` in its
   * query string, and for success carries the pending-request identifier).
   */
  #log(
    result: "success" | "error",
    clientId: string | undefined,
    error: string | undefined,
    peerIp: string | null,
    redirectLocation?: string
  ): void {
    const context: Record<string, unknown> = {
      endpoint: "authorize",
      result,
      client_id: clientId,
      rate_limit_key: peerIp,
    };

    if (error) {
      context.error = error;
    }

    if (redirectLocation) {
      context.redirect_host = new URL(redirectLocation).host;
    }

    if (result === "success") {
      this.logger.info("authorize", context);
    } else {
      this.logger.warn("authorize", context);
    }
  }
}
