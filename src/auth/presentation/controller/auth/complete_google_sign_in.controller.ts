import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import type { RateLimitPolicy } from "../../../../core/application/rate_limit/rate_limit_policy";
import type { Logger } from "../../../../core/application/logger/logger";
import { frontBaseUrl } from "../../../../core/infra/config/environments";
import { pgErrorCode } from "../../../../core/infra/database/postgres_error";
import type {
  CompleteExternalSignInResult,
  CompleteExternalSignInUseCase,
} from "../../../application/use_case/complete_external_sign_in";
import { buildSessionCookie } from "../../http/session_cookie";
import {
  buildClearedExternalSignInCookie,
  readExternalSignInCookieVerifier,
} from "../../http/external_sign_in_cookie";
import { parseUniqueQueryParams } from "../delegated_access/unique_query_params";
import {
  GOOGLE_SIGN_IN_CALLBACK_PATH,
  buildGoogleSignInResultUrl,
} from "./google_sign_in_paths";

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 20,
};

export class CompleteGoogleSignInController implements Controller {
  path = GOOGLE_SIGN_IN_CALLBACK_PATH;
  method = HttpControllerMethod.GET;
  parameterSource = "query" as const;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Complete Google sign-in",
    description:
      "Navigation route Google redirects the browser back to after the consent screen. Called by Google, never by the front directly or via fetch. Always redirects to the front's result route: status=signed_in|linked|account_created on success, or error=canceled|expired|email_not_verified|account_conflict|unavailable on failure.",
    tags: ["Auth"],
    parameters: [
      {
        name: "state",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
      {
        name: "code",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
      {
        name: "error",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
    ],
    responses: {
      "302": {
        description: "Redirects to the front's Google sign-in result route.",
      },
    },
  };

  constructor(
    private readonly useCase: CompleteExternalSignInUseCase,
    private readonly logger: Logger
  ) {}

  async handle(request: ControllerRequest): Promise<ControllerHttpResponse> {
    const query = parseUniqueQueryParams(request.url);
    const codeVerifier = readExternalSignInCookieVerifier(request);

    const result = await this.useCase.execute({
      query,
      code_verifier: codeVerifier,
    });

    return this.#respond(result, request.peerIp);
  }

  #respond(
    result: CompleteExternalSignInResult,
    peerIp: string | null
  ): ControllerHttpResponse {
    if (result.outcome === "denied") {
      this.#log(
        "error",
        result.error,
        result.reason,
        peerIp,
        undefined,
        result.cause
      );
      return this.#redirect(
        buildGoogleSignInResultUrl(
          frontBaseUrl,
          { error: result.error },
          result.return_to
        ),
        { clearCookie: true }
      );
    }

    this.#log("success", result.outcome, undefined, peerIp, result.user_id);

    return this.#redirect(
      buildGoogleSignInResultUrl(
        frontBaseUrl,
        { status: result.outcome },
        result.return_to
      ),
      { sessionToken: result.token }
    );
  }

  #redirect(
    location: string,
    opts: { sessionToken?: string; clearCookie?: boolean }
  ): ControllerHttpResponse {
    const headers: Record<string, string> = {
      Location: location,
      "Referrer-Policy": "no-referrer",
    };

    if (opts.sessionToken) {
      headers["Set-Cookie"] = buildSessionCookie(opts.sessionToken);
    } else if (opts.clearCookie) {
      headers["Set-Cookie"] = buildClearedExternalSignInCookie();
    }

    return new ControllerHttpResponse({
      status: 302,
      cache: "no-store",
      headers,
    });
  }

  #log(
    result: "success" | "error",
    outcome: string,
    reason: string | undefined,
    peerIp: string | null,
    userId?: string,
    cause?: unknown
  ): void {
    const context: Record<string, unknown> = {
      endpoint: "google_sign_in_callback",
      result,
      outcome,
      provider: "google",
      rate_limit_key: peerIp,
    };

    if (reason) {
      context.reason = reason;
    }

    if (userId) {
      context.user_id = userId;
    }

    if (cause instanceof Error) {
      context.error_name = cause.name;
      const code = pgErrorCode(cause);
      if (code) {
        context.error_code = code;
      }
    }

    if (result === "success") {
      this.logger.info("google_sign_in_callback", context);
    } else {
      this.logger.warn("google_sign_in_callback", context);
    }
  }
}
