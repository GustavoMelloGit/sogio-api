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
import type { AppRegistrationRepository } from "../../../domain/repository/delegated_access/app_registration_repository";
import type {
  RevocableTokenType,
  RevokeTokenUseCase,
} from "../../../application/use_case/revoke_token";
import { OAUTH_REVOCATION_ENDPOINT_PATH } from "./oauth_authorization_server_metadata.controller";
import { oauthProtocolError } from "./oauth_error_response";
import { parseUniqueFormParams } from "./unique_query_params";

const clientIdSchema = z.uuidv4();

const OAUTH_SUPPORTED_TOKEN_TYPE_HINTS: readonly RevocableTokenType[] = [
  "access_token",
  "refresh_token",
];

/**
 * Automatic, adapter-enforced dimension of E5's two: the caller's peer IP,
 * checked before this controller ever runs — same policy `TokenController`
 * declares for `/token`.
 */
const PEER_IP_RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 30,
};

/**
 * The second dimension, applied by this controller directly, only when
 * `client_id` is present — unlike `/token`, `client_id` is optional at
 * `/revoke` (see `RevokeTokenUseCase`'s docstring for why), so this
 * dimension is opt-in rather than mandatory on every request.
 *
 * **Correção pós-revisão (M6).** Como em `TokenController`, só é alimentado
 * depois de confirmar que `client_id` identifica um registro existente —
 * `RevokeController` e `TokenController` são construídos pelo mesmo `AuthDi`
 * e portanto compartilham a mesma instância de `RateLimiter`: sem essa
 * checagem aqui também, um UUID novo por requisição enviado a `/revoke`
 * esgotaria o mesmo mapa que a dimensão `client_id` de `/token` usa, negando
 * `/token` a aplicativos novos por uma porta diferente da nomeada no achado.
 */
const CLIENT_ID_RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "caller-key",
  windowMs: 60 * 1000,
  maxAttempts: 60,
};

function buildClientRateLimitKey(clientId: string): string {
  return `revoke:client_id:${clientId}`;
}

/**
 * `POST /revoke` (task 12, RFC 7009 §2). Reads exclusively from the
 * `x-www-form-urlencoded` body (E1) via `parseUniqueFormParams`, the same
 * discipline and helper `TokenController` uses for `/token` — never
 * `request.body`, which the adapter has already collapsed to one value per
 * key. No `inputSchema`, for the same E7 reason documented on every other
 * delegated-access controller: a `ValidationError` from that pipeline would
 * answer with the API's default `{ message }` shape, not the OAuth error
 * shape. Every response is `cache: "no-store"` (E8); no `corsPolicy` — a
 * protocol route with credentials at stake keeps the default CORS
 * restricted to the configured front origin, same as `/token`.
 *
 * **The response never distinguishes outcomes (RFC 7009 §2.2).** Whether
 * the token doesn't exist, is already expired, is already revoked, or
 * belongs to another application, the HTTP answer is identically `200`
 * with an empty body. Only malformed *input* — a duplicated parameter, a
 * missing `token`, an unsupported `token_type_hint`, a malformed
 * `client_id` — gets a distinct `4xx`, because those describe the shape of
 * the request the caller already knows they sent, not anything about the
 * token's status. `RevokeTokenUseCase.execute`'s `outcome` is read only for
 * the log line below (E7 allows "resultado"); it never varies the
 * response.
 */
export class RevokeController implements Controller {
  path = OAUTH_REVOCATION_ENDPOINT_PATH;
  method = HttpControllerMethod.POST;
  parameterSource = "form" as const;
  rateLimitPolicy = PEER_IP_RATE_LIMIT_POLICY;

  constructor(
    private readonly revokeTokenUseCase: RevokeTokenUseCase,
    private readonly appRegistrationRepository: AppRegistrationRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly logger: Logger
  ) {}

  async handle(request: ControllerRequest): Promise<ControllerHttpResponse> {
    const params = parseUniqueFormParams(request.rawBody);
    if (!params) {
      this.#log("warn", "invalid_request", undefined, request.peerIp);
      return oauthProtocolError(
        400,
        "invalid_request",
        "The request body contains a duplicated parameter."
      );
    }

    const clientIdResolution = this.#resolveClientId(params.client_id);
    if (clientIdResolution === "invalid") {
      this.#log("warn", "invalid_client", undefined, request.peerIp);
      return oauthProtocolError(
        400,
        "invalid_client",
        "client_id, when present, must identify a registered application."
      );
    }
    const clientId = clientIdResolution;

    if (clientId !== undefined) {
      const appRegistration =
        await this.appRegistrationRepository.findById(clientId);
      if (!appRegistration) {
        this.#log("warn", "invalid_client", clientId, request.peerIp);
        return oauthProtocolError(
          400,
          "invalid_client",
          "client_id, when present, must identify a registered application."
        );
      }

      const rateLimitDecision = this.rateLimiter.consume(
        buildClientRateLimitKey(clientId),
        CLIENT_ID_RATE_LIMIT_POLICY
      );
      if (!rateLimitDecision.allowed) {
        this.#log("warn", "rate_limited", clientId, request.peerIp);
        return new ControllerHttpResponse({
          status: 429,
          cache: "no-store",
          headers: {
            "Retry-After": String(rateLimitDecision.retryAfterSeconds),
          },
          body: { error: "rate_limited" },
        });
      }
    }

    const token = params.token;
    if (!token) {
      this.#log("warn", "invalid_request", clientId, request.peerIp);
      return oauthProtocolError(400, "invalid_request", "token is required.");
    }

    const tokenTypeHint = params.token_type_hint;
    if (
      tokenTypeHint !== undefined &&
      !OAUTH_SUPPORTED_TOKEN_TYPE_HINTS.includes(
        tokenTypeHint as RevocableTokenType
      )
    ) {
      this.#log("warn", "unsupported_token_type", clientId, request.peerIp);
      return oauthProtocolError(
        400,
        "unsupported_token_type",
        `token_type_hint must be one of: ${OAUTH_SUPPORTED_TOKEN_TYPE_HINTS.join(", ")}.`
      );
    }

    const result = await this.revokeTokenUseCase.execute({
      token,
      tokenTypeHint: tokenTypeHint as RevocableTokenType | undefined,
      clientId,
    });

    this.#log(
      result.outcome === "client_mismatch" ? "warn" : "info",
      result.outcome,
      clientId,
      request.peerIp
    );

    return new ControllerHttpResponse({
      status: 200,
      cache: "no-store",
      body: {},
    });
  }

  /**
   * `client_id` is optional at `/revoke` (unlike `/token`): `undefined`
   * when absent, the validated id when well-formed, or the sentinel
   * `"invalid"` when present but malformed.
   */
  #resolveClientId(
    rawClientId: string | undefined
  ): string | undefined | "invalid" {
    if (rawClientId === undefined) {
      return undefined;
    }

    const clientIdCheck = clientIdSchema.safeParse(rawClientId);
    return clientIdCheck.success ? clientIdCheck.data : "invalid";
  }

  /**
   * E7's allowlist: endpoint name, result (either an OAuth error code or
   * `RevokeTokenUseCase`'s internal outcome — never surfaced in the
   * response), `client_id`, and the rate limit key (peer IP). Never the
   * token, its digest, or anything else about the request body.
   */
  #log(
    level: "info" | "warn",
    result: string,
    clientId: string | undefined,
    peerIp: string | null
  ): void {
    const context: Record<string, unknown> = {
      endpoint: "revoke",
      result,
      client_id: clientId,
      rate_limit_key: peerIp,
    };

    if (level === "warn") {
      this.logger.warn("revoke", context);
    } else {
      this.logger.info("revoke", context);
    }
  }
}
