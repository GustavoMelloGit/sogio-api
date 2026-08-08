import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
} from "../../../../core/presentation/controller/controller";
import { apiBaseUrl } from "../../../../core/infra/config/environments";

export const OAUTH_AUTHORIZATION_SERVER_METADATA_PATH =
  "/.well-known/oauth-authorization-server";

/**
 * Paths of the protocol endpoints themselves (tasks 8, 9, 11, 12 — none of
 * them exist yet). Chosen to be RFC 8414-idiomatic and mounted directly off
 * the issuer, matching the examples in the plan
 * (`.claude/plans/2026-08-08-mcp-oauth-authorization.md`, "Diretrizes para o
 * Desenvolvedor": `${issuer}/authorize`, `${issuer}/token`). Declared here,
 * ahead of their controllers, so the metadata document and the eventual
 * routes can't drift apart.
 */
export const OAUTH_AUTHORIZATION_ENDPOINT_PATH = "/authorize";
export const OAUTH_TOKEN_ENDPOINT_PATH = "/token";
export const OAUTH_REGISTRATION_ENDPOINT_PATH = "/register";
export const OAUTH_REVOCATION_ENDPOINT_PATH = "/revoke";

/**
 * Closed vocabulary this authorization server supports, announced here and
 * nowhere else. `/register` (task 8) imports these same constants to reject
 * a `grant_types`/`response_types`/`token_endpoint_auth_method` outside of
 * what the metadata document advertises — the two can't drift apart because
 * there is only one array in memory for each.
 */
export const OAUTH_SUPPORTED_RESPONSE_TYPES: readonly string[] = ["code"];
export const OAUTH_SUPPORTED_GRANT_TYPES: readonly string[] = [
  "authorization_code",
  "refresh_token",
];
export const OAUTH_SUPPORTED_CODE_CHALLENGE_METHODS: readonly string[] = [
  "S256",
];
export const OAUTH_SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS: readonly string[] = [
  "none",
];

const CACHE_CONTROL = "public, max-age=21600";

/**
 * Serves the authorization server metadata document (RFC 8414). `issuer` is
 * `apiBaseUrl` byte-for-byte, per the plan's identity requirement — never
 * derived from `request.url`/`Host`.
 *
 * Deliberately omits anything from RFC 7592 (client configuration
 * management): no `_client_uri`-style field, no pointer to a registration
 * management endpoint. RFC 7592 is out of scope (E6) and not implemented, so
 * advertising it here would promise a capability that doesn't exist.
 *
 * Static and public, same reasoning as the resource metadata controller: a
 * pure function of configuration, no use case needed.
 */
export class OAuthAuthorizationServerMetadataController implements Controller {
  path = OAUTH_AUTHORIZATION_SERVER_METADATA_PATH;
  method = HttpControllerMethod.GET;
  corsPolicy = "public" as const;

  async handle(): Promise<ControllerHttpResponse> {
    const issuer = apiBaseUrl;

    return new ControllerHttpResponse({
      status: 200,
      body: {
        issuer,
        authorization_endpoint: `${issuer}${OAUTH_AUTHORIZATION_ENDPOINT_PATH}`,
        token_endpoint: `${issuer}${OAUTH_TOKEN_ENDPOINT_PATH}`,
        registration_endpoint: `${issuer}${OAUTH_REGISTRATION_ENDPOINT_PATH}`,
        revocation_endpoint: `${issuer}${OAUTH_REVOCATION_ENDPOINT_PATH}`,
        response_types_supported: OAUTH_SUPPORTED_RESPONSE_TYPES,
        grant_types_supported: OAUTH_SUPPORTED_GRANT_TYPES,
        code_challenge_methods_supported:
          OAUTH_SUPPORTED_CODE_CHALLENGE_METHODS,
        token_endpoint_auth_methods_supported:
          OAUTH_SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS,
      },
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }
}
