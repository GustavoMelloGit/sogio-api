import { z } from "zod";
import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { RateLimitPolicy } from "../../../../core/application/rate_limit/rate_limit_policy";
import type { RateLimiter } from "../../../../core/application/rate_limit/rate_limiter";
import type { Logger } from "../../../../core/application/logger/logger";
import { apiBaseUrl } from "../../../../core/infra/config/environments";
import type { ExchangeAuthorizationCodeUseCase } from "../../../application/use_case/exchange_authorization_code";
import type { RefreshAccessTokenUseCase } from "../../../application/use_case/refresh_access_token";
import type { TokenExchangeResult } from "../../../application/use_case/token_exchange_result";
import { MCP_RESOURCE_PATH } from "./oauth_protected_resource_metadata.controller";
import {
  OAUTH_SUPPORTED_GRANT_TYPES,
  OAUTH_TOKEN_ENDPOINT_PATH,
} from "./oauth_authorization_server_metadata.controller";
import { oauthProtocolError } from "./oauth_error_response";
import { parseUniqueFormParams } from "./unique_query_params";

const clientIdSchema = z.uuidv4();

/**
 * Fixed, generic description for every business-logic failure of either
 * grant type (risk #4 — see `TokenExchangeResult`'s docstring for why the
 * use cases collapse everything down to this one outcome in the first
 * place). Never varies by cause, never echoes anything from the request.
 */
const INVALID_GRANT_DESCRIPTION =
  "The provided authorization grant is invalid, expired, revoked, or does not belong to this client.";

/**
 * Automatic, adapter-enforced dimension of E5's two: the caller's peer IP,
 * checked before this controller ever runs.
 */
const PEER_IP_RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 30,
};

/**
 * The second of E5's two dimensions for `/token`: per `client_id`, enforced
 * by this controller directly (the adapter's automatic check only knows
 * about peer IP — see `RateLimitKeyDimension`'s docstring). Looser than the
 * per-IP policy because one application's `client_id` is shared by every
 * user who has connected it, not just one caller.
 */
const CLIENT_ID_RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "caller-key",
  windowMs: 60 * 1000,
  maxAttempts: 60,
};

function buildClientRateLimitKey(clientId: string): string {
  return `token:client_id:${clientId}`;
}

/**
 * `POST /token` (task 11) — the authorization code exchange and the refresh
 * rotation, RFC 6749 §4.1.3 / §6. Reads exclusively from the
 * `x-www-form-urlencoded` body (E1): `parseUniqueFormParams` re-derives the
 * parameters from `request.rawBody` itself, never `request.body`, which the
 * adapter has already collapsed to one value per key — the same discipline
 * `AuthorizeController` applies to `request.url` for the query string, and
 * for the same reason: a duplicated key has to fail the request outright,
 * before any of it is used for anything, including building the rate limit
 * key below.
 *
 * No `inputSchema`: a `ValidationError` from that pipeline would answer
 * with the API's default `{ message }` shape rather than the OAuth error
 * shape this endpoint requires (the same reasoning documented on every
 * other delegated-access controller). Every response — success or error —
 * is `cache: "no-store"` (E8), via `ControllerHttpResponse`/
 * `oauthProtocolError`. No `corsPolicy`: unlike the two discovery
 * documents, this is a protocol route with credentials at stake, so it
 * keeps the default CORS behavior restricted to the configured front
 * origin (E8).
 *
 * `client_id` is required up front for both grant types (RFC 6749 §3.2.1 —
 * a public client, `token_endpoint_auth_method: none`, has no other way to
 * identify itself) and, structurally, before either grant's own validation
 * ever runs, since it's also this route's second rate-limit dimension
 * (E5) — a malformed or missing `client_id` can be rejected without
 * touching the database at all.
 */
export class TokenController implements Controller {
  path = OAUTH_TOKEN_ENDPOINT_PATH;
  method = HttpControllerMethod.POST;
  parameterSource = "form" as const;
  rateLimitPolicy = PEER_IP_RATE_LIMIT_POLICY;

  constructor(
    private readonly exchangeAuthorizationCodeUseCase: ExchangeAuthorizationCodeUseCase,
    private readonly refreshAccessTokenUseCase: RefreshAccessTokenUseCase,
    private readonly rateLimiter: RateLimiter,
    private readonly logger: Logger
  ) {}

  async handle(request: ControllerRequest): Promise<ControllerHttpResponse> {
    const params = parseUniqueFormParams(request.rawBody);
    if (!params) {
      this.#log("error", undefined, "invalid_request", request.peerIp);
      return oauthProtocolError(
        400,
        "invalid_request",
        "The request body contains a duplicated parameter."
      );
    }

    const clientIdCheck = clientIdSchema.safeParse(params.client_id);
    if (!clientIdCheck.success) {
      this.#log("error", undefined, "invalid_client", request.peerIp);
      return oauthProtocolError(
        400,
        "invalid_client",
        "client_id is required and must identify a registered application."
      );
    }
    const clientId = clientIdCheck.data;

    const rateLimitDecision = this.rateLimiter.consume(
      buildClientRateLimitKey(clientId),
      CLIENT_ID_RATE_LIMIT_POLICY
    );
    if (!rateLimitDecision.allowed) {
      this.#log("error", clientId, "rate_limited", request.peerIp);
      return new ControllerHttpResponse({
        status: 429,
        cache: "no-store",
        headers: { "Retry-After": String(rateLimitDecision.retryAfterSeconds) },
        body: { error: "rate_limited" },
      });
    }

    if (params.grant_type === "authorization_code") {
      return this.#handleAuthorizationCodeGrant(
        params,
        clientId,
        request.peerIp
      );
    }

    if (params.grant_type === "refresh_token") {
      return this.#handleRefreshTokenGrant(params, clientId, request.peerIp);
    }

    this.#log("error", clientId, "unsupported_grant_type", request.peerIp);
    return oauthProtocolError(
      400,
      "unsupported_grant_type",
      `grant_type must be one of: ${OAUTH_SUPPORTED_GRANT_TYPES.join(", ")}.`
    );
  }

  async #handleAuthorizationCodeGrant(
    params: Record<string, string>,
    clientId: string,
    peerIp: string | null
  ): Promise<ControllerHttpResponse> {
    const code = params.code;
    const redirectUri = params.redirect_uri;
    const codeVerifier = params.code_verifier;

    if (!code || !redirectUri || !codeVerifier) {
      this.#log("error", clientId, "invalid_request", peerIp);
      return oauthProtocolError(
        400,
        "invalid_request",
        "code, redirect_uri, and code_verifier are required."
      );
    }

    const result = await this.exchangeAuthorizationCodeUseCase.execute({
      code,
      redirectUri,
      codeVerifier,
      clientId,
      expectedResource: `${apiBaseUrl}${MCP_RESOURCE_PATH}`,
    });

    return this.#respond(result, clientId, peerIp);
  }

  async #handleRefreshTokenGrant(
    params: Record<string, string>,
    clientId: string,
    peerIp: string | null
  ): Promise<ControllerHttpResponse> {
    const refreshToken = params.refresh_token;

    if (!refreshToken) {
      this.#log("error", clientId, "invalid_request", peerIp);
      return oauthProtocolError(
        400,
        "invalid_request",
        "refresh_token is required."
      );
    }

    const result = await this.refreshAccessTokenUseCase.execute({
      refreshToken,
    });

    return this.#respond(result, clientId, peerIp);
  }

  #respond(
    result: TokenExchangeResult,
    clientId: string,
    peerIp: string | null
  ): ControllerHttpResponse {
    if (result.outcome === "invalid_grant") {
      this.#log("error", clientId, "invalid_grant", peerIp);
      return oauthProtocolError(
        400,
        "invalid_grant",
        INVALID_GRANT_DESCRIPTION
      );
    }

    this.#log("success", clientId, undefined, peerIp);
    return new ControllerHttpResponse({
      status: 200,
      cache: "no-store",
      body: {
        access_token: result.accessToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
        scope: result.scope,
      },
    });
  }

  /**
   * E7's allowlist: endpoint name, outcome, OAuth error code, `client_id`,
   * and the rate limit key (peer IP). Never the code, verifier, challenge,
   * either token, or `redirect_uri`.
   */
  #log(
    result: "success" | "error",
    clientId: string | undefined,
    error: string | undefined,
    peerIp: string | null
  ): void {
    const context: Record<string, unknown> = {
      endpoint: "token",
      result,
      client_id: clientId,
      rate_limit_key: peerIp,
    };

    if (error) {
      context.error = error;
    }

    if (result === "success") {
      this.logger.info("token", context);
    } else {
      this.logger.warn("token", context);
    }
  }
}
