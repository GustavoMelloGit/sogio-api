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
import type {
  StartExternalSignInResult,
  StartExternalSignInUseCase,
} from "../../../application/use_case/start_external_sign_in";
import { buildExternalSignInCookie } from "../../http/external_sign_in_cookie";
import {
  GOOGLE_SIGN_IN_START_PATH,
  buildGoogleSignInResultUrl,
} from "./google_sign_in_paths";

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 1000,
  maxAttempts: 20,
};

export class StartGoogleSignInController implements Controller {
  path = GOOGLE_SIGN_IN_START_PATH;
  method = HttpControllerMethod.GET;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Start Google sign-in",
    description:
      "Navigation route: redirects the browser to Google's consent screen to begin the Google sign-in flow. Never called via fetch. When the provider isn't configured, redirects straight to the front's result route with error=unavailable instead.",
    tags: ["Auth"],
    parameters: [
      {
        name: "return_to",
        in: "query",
        required: false,
        description:
          "Relative path of the front to return to once the flow completes. Silently ignored when invalid.",
        schema: { type: "string" },
      },
    ],
    responses: {
      "302": {
        description:
          "Redirects to Google's authorization endpoint, or to the front's result route with error=unavailable.",
      },
    },
  };

  constructor(
    private readonly useCase: StartExternalSignInUseCase,
    private readonly logger: Logger
  ) {}

  async handle(request: ControllerRequest): Promise<ControllerHttpResponse> {
    const result = await this.useCase.execute({
      return_to: request.query.return_to,
    });

    return this.#respond(result, request.peerIp);
  }

  #respond(
    result: StartExternalSignInResult,
    peerIp: string | null
  ): ControllerHttpResponse {
    if (result.outcome === "unavailable") {
      this.#log("error", "unavailable", peerIp);
      return this.#redirect(
        buildGoogleSignInResultUrl(frontBaseUrl, { error: "unavailable" }, null)
      );
    }

    this.#log("success", "redirect", peerIp);

    const maxAgeSeconds = Math.max(
      0,
      Math.floor((result.expires_at.getTime() - Date.now()) / 1000)
    );

    return new ControllerHttpResponse({
      status: 302,
      cache: "no-store",
      headers: {
        Location: result.authorization_url,
        "Set-Cookie": buildExternalSignInCookie(
          result.code_verifier,
          maxAgeSeconds
        ),
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  #redirect(location: string): ControllerHttpResponse {
    return new ControllerHttpResponse({
      status: 302,
      cache: "no-store",
      headers: { Location: location, "Referrer-Policy": "no-referrer" },
    });
  }

  #log(
    result: "success" | "error",
    outcome: string,
    peerIp: string | null
  ): void {
    const context: Record<string, unknown> = {
      endpoint: "google_sign_in_start",
      result,
      outcome,
      provider: "google",
      rate_limit_key: peerIp,
    };

    if (result === "success") {
      this.logger.info("google_sign_in_start", context);
    } else {
      this.logger.warn("google_sign_in_start", context);
    }
  }
}
