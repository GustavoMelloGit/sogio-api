import { z } from "zod";
import { AuthorizationRequest } from "../../domain/entity/delegated_access/authorization_request";
import type { AppRegistrationRepository } from "../../domain/repository/delegated_access/app_registration_repository";
import type { AuthorizationRequestRepository } from "../../domain/repository/delegated_access/authorization_request_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { redirectUriMatches } from "../../domain/service/redirect_uri_policy";
import { isSupportedScope } from "../../domain/service/oauth_scope_policy";
import type { UseCase } from "../../../core/application/use_case/use_case";

export type InitiateAuthorizationInput = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  resource?: string;
  state?: string;
  /**
   * The canonical `/mcp` resource URL (`${apiBaseUrl}${MCP_RESOURCE_PATH}`),
   * computed by the controller. Passed in rather than imported here so this
   * use case (application layer) never reaches into the presentation
   * controller that owns `MCP_RESOURCE_PATH`.
   */
  expectedResource: string;
};

export type InitiateAuthorizationResult =
  | { mode: "A"; error: string; errorDescription: string }
  | {
      mode: "B";
      redirectUri: string;
      state: string | undefined;
      error: string;
      errorDescription: string;
    }
  | { mode: "success"; requestIdentifier: string };

/**
 * A pending Authorization Request outlives the time a real user takes to
 * get from the client's redirect to the front's consent screen and back —
 * minutes, not hours (Decisão Resolvida #8). Short enough that a leaked
 * pending-request identifier is worthless within a few minutes of issuance.
 */
const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;

const MAX_CODE_CHALLENGE_LENGTH = 255;
const MAX_STATE_LENGTH = 512;

const clientIdSchema = z.uuidv4();

/**
 * Ordered validation of `/authorize` (E2, steps 2-11 — step 0 is the
 * controller's declared rate limit policy and step 1 is the controller's
 * own duplicate-parameter check on the raw query string, both ahead of this
 * use case ever being called). The first failing step decides the
 * response's error mode:
 *
 * - Steps 2-5 (client_id, app registration, redirect_uri presence and
 *   match) have no verified redirect target yet — Mode A. Nothing here
 *   redirects; the controller renders an inert error page.
 * - From step 6 on, `redirect_uri` has already been matched against the
 *   registration (E3), so failures redirect there with an OAuth error —
 *   Mode B.
 *
 * Success persists a Pending Authorization Request with a short TTL and an
 * unpredictable opaque identifier — only its digest is stored (E10) — for
 * the controller to hand the front as the sole parameter of the consent
 * redirect. Nothing here decides *where* that redirect points (the front's
 * base URL is a presentation/config concern); it only returns the opaque
 * identifier.
 */
export class InitiateAuthorizationUseCase
  implements UseCase<InitiateAuthorizationInput, InitiateAuthorizationResult>
{
  constructor(
    private readonly appRegistrationRepository: AppRegistrationRepository,
    private readonly authorizationRequestRepository: AuthorizationRequestRepository,
    private readonly secretService: DelegatedSecretService
  ) {}

  async execute(
    input: InitiateAuthorizationInput
  ): Promise<InitiateAuthorizationResult> {
    const clientIdCheck = clientIdSchema.safeParse(input.client_id);
    if (!clientIdCheck.success) {
      return this.#modeA(
        "invalid_client",
        "client_id is missing or malformed."
      );
    }

    const appRegistration = await this.appRegistrationRepository.findById(
      clientIdCheck.data
    );
    if (!appRegistration) {
      return this.#modeA(
        "invalid_client",
        "client_id does not identify a registered application."
      );
    }

    const redirectUri = input.redirect_uri;
    if (!redirectUri) {
      return this.#modeA("invalid_request", "redirect_uri is required.");
    }

    const redirectUriIsRegistered = appRegistration.redirect_uris.some(
      registered => redirectUriMatches(registered, redirectUri)
    );
    if (!redirectUriIsRegistered) {
      return this.#modeA(
        "invalid_request",
        "redirect_uri does not match a redirect URI registered for this application."
      );
    }

    if (input.response_type !== "code") {
      return this.#modeB(
        redirectUri,
        input.state,
        "unsupported_response_type",
        "Only the authorization code response type is supported."
      );
    }

    if (
      !input.code_challenge ||
      input.code_challenge.length > MAX_CODE_CHALLENGE_LENGTH ||
      input.code_challenge_method !== "S256"
    ) {
      return this.#modeB(
        redirectUri,
        input.state,
        "invalid_request",
        "A code_challenge with code_challenge_method=S256 is required."
      );
    }

    const scope = input.scope;
    if (!scope || !isSupportedScope(scope)) {
      return this.#modeB(
        redirectUri,
        input.state,
        "invalid_scope",
        "scope must be one of the scopes this server supports."
      );
    }

    if (input.resource !== input.expectedResource) {
      return this.#modeB(
        redirectUri,
        input.state,
        "invalid_target",
        "resource must identify this server's MCP resource."
      );
    }

    if (input.state !== undefined && input.state.length > MAX_STATE_LENGTH) {
      return this.#modeB(
        redirectUri,
        input.state,
        "invalid_request",
        "state exceeds the maximum allowed length."
      );
    }

    const { secret, digest } = this.secretService.generate();

    const authorizationRequest = AuthorizationRequest.create({
      identifier_digest: digest,
      app_registration_id: appRegistration.id,
      redirect_uri: redirectUri,
      code_challenge: input.code_challenge,
      code_challenge_method: "S256",
      scope,
      resource: input.resource,
      state: input.state,
      expires_at: new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS),
    });

    await this.authorizationRequestRepository.create(authorizationRequest);

    return { mode: "success", requestIdentifier: secret };
  }

  #modeA(error: string, errorDescription: string): InitiateAuthorizationResult {
    return { mode: "A", error, errorDescription };
  }

  #modeB(
    redirectUri: string,
    state: string | undefined,
    error: string,
    errorDescription: string
  ): InitiateAuthorizationResult {
    return { mode: "B", redirectUri, state, error, errorDescription };
  }
}
