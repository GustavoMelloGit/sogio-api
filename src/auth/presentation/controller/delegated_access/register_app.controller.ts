import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { RateLimitPolicy } from "../../../../core/application/rate_limit/rate_limit_policy";
import type { RegisterAppUseCase } from "../../../application/use_case/register_app";
import {
  MAX_CLIENT_NAME_LENGTH,
  MAX_REDIRECT_URIS,
  MAX_REDIRECT_URI_LENGTH,
} from "../../../domain/entity/delegated_access/app_registration";
import { hasUnsafeDisplayNameCharacters } from "../../../domain/service/app_display_name_policy";
import { isRegistrableRedirectUri } from "../../../domain/service/redirect_uri_policy";
import {
  OAUTH_REGISTRATION_ENDPOINT_PATH,
  OAUTH_SUPPORTED_GRANT_TYPES,
  OAUTH_SUPPORTED_RESPONSE_TYPES,
  OAUTH_SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS,
} from "./oauth_authorization_server_metadata.controller";
import { oauthProtocolError } from "./oauth_error_response";

type ValidInput = {
  client_name: string;
  redirect_uris: string[];
};

type ValidationFailure = {
  status: number;
  error: string;
  errorDescription: string;
};

type ValidationResult =
  | { ok: true; data: ValidInput }
  | { ok: false; failure: ValidationFailure };

/**
 * Per-IP limit on dynamic client registration (E5). Registering is
 * unauthenticated by design (RFC 7591), so the peer IP is the only caller
 * identity available; this is the one control keeping an open endpoint
 * from inflating the registration table indefinitely between purge runs.
 */
const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 60 * 60 * 1000,
  maxAttempts: 20,
};

/**
 * Dynamic client registration (RFC 7591). Public, unauthenticated, JSON
 * body only (E1) — hence no `inputSchema`/generic validation pipeline: a
 * failure here must respond with the OAuth error shape and a fixed
 * description (E7), never the API's default `{ message }` shape carrying
 * Zod's dynamic detail. All validation therefore happens by hand, ahead of
 * ever throwing anything.
 *
 * Rejects a confidential client (`token_endpoint_auth_method` other than
 * "none"), a `logo_uri` (E6 — not merely ignored), a `client_name` with
 * disallowed characters or out of the size limit (E6), a `redirect_uris`
 * that is missing, empty, over the cardinality/size limit, or contains any
 * URI the registration policy rejects (E3), and a `grant_types`/
 * `response_types` outside the vocabulary the metadata document announces.
 * Unrecognized RFC 7591 fields are silently ignored, never persisted.
 *
 * RFC 7592 (client self-management) is out of scope (E6): the success
 * response carries no `registration_access_token` or
 * `registration_client_uri`.
 */
export class RegisterAppController implements Controller {
  path = OAUTH_REGISTRATION_ENDPOINT_PATH;
  method = HttpControllerMethod.POST;
  parameterSource = "json" as const;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  constructor(private readonly useCase: RegisterAppUseCase) {}

  async handle(request: ControllerRequest): Promise<ControllerHttpResponse> {
    const validation = this.#validate(request.body);

    if (!validation.ok) {
      return oauthProtocolError(
        validation.failure.status,
        validation.failure.error,
        validation.failure.errorDescription
      );
    }

    const output = await this.useCase.execute(validation.data);

    return new ControllerHttpResponse({
      status: 201,
      cache: "no-store",
      body: {
        client_id: output.id,
        client_id_issued_at: Math.floor(output.created_at.getTime() / 1000),
        client_name: output.client_name,
        redirect_uris: output.redirect_uris,
        token_endpoint_auth_method: output.token_endpoint_auth_method,
        grant_types: [...OAUTH_SUPPORTED_GRANT_TYPES],
        response_types: [...OAUTH_SUPPORTED_RESPONSE_TYPES],
      },
    });
  }

  #validate(body: Record<string, unknown>): ValidationResult {
    if ("logo_uri" in body) {
      return this.#invalidClientMetadata(
        "The logo_uri field is not supported."
      );
    }

    const authMethod = body.token_endpoint_auth_method;
    if (
      authMethod !== undefined &&
      (typeof authMethod !== "string" ||
        !OAUTH_SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS.includes(authMethod))
    ) {
      return this.#invalidClientMetadata(
        "Only the public client authentication method is supported."
      );
    }

    const clientName = body.client_name;
    if (
      typeof clientName !== "string" ||
      clientName.length < 1 ||
      clientName.length > MAX_CLIENT_NAME_LENGTH ||
      hasUnsafeDisplayNameCharacters(clientName)
    ) {
      return this.#invalidClientMetadata(
        "client_name is required and must be a valid display name."
      );
    }

    if (
      !this.#isSupportedVocabulary(
        body.grant_types,
        OAUTH_SUPPORTED_GRANT_TYPES
      )
    ) {
      return this.#invalidClientMetadata(
        "grant_types must be a subset of the supported grant types."
      );
    }

    if (
      !this.#isSupportedVocabulary(
        body.response_types,
        OAUTH_SUPPORTED_RESPONSE_TYPES
      )
    ) {
      return this.#invalidClientMetadata(
        "response_types must be a subset of the supported response types."
      );
    }

    const redirectUris = body.redirect_uris;
    const redirectUrisValid =
      Array.isArray(redirectUris) &&
      redirectUris.length >= 1 &&
      redirectUris.length <= MAX_REDIRECT_URIS &&
      redirectUris.every(
        uri =>
          typeof uri === "string" &&
          uri.length <= MAX_REDIRECT_URI_LENGTH &&
          isRegistrableRedirectUri(uri)
      );

    if (!redirectUrisValid) {
      return this.#invalidRedirectUri();
    }

    return {
      ok: true,
      data: {
        client_name: clientName,
        redirect_uris: redirectUris as string[],
      },
    };
  }

  #isSupportedVocabulary(
    value: unknown,
    supported: readonly string[]
  ): boolean {
    if (value === undefined) {
      return true;
    }

    return (
      Array.isArray(value) &&
      value.every(item => typeof item === "string" && supported.includes(item))
    );
  }

  #invalidClientMetadata(errorDescription: string): {
    ok: false;
    failure: ValidationFailure;
  } {
    return {
      ok: false,
      failure: {
        status: 400,
        error: "invalid_client_metadata",
        errorDescription,
      },
    };
  }

  #invalidRedirectUri(): { ok: false; failure: ValidationFailure } {
    return {
      ok: false,
      failure: {
        status: 400,
        error: "invalid_redirect_uri",
        errorDescription: "One or more redirect_uris are invalid.",
      },
    };
  }
}
