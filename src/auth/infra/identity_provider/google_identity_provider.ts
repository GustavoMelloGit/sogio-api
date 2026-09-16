import type {
  BuildAuthorizationUrlInput,
  ExchangeCodeInput,
  ExternalIdentityProvider,
  ExternalIdentityExchangeResult,
} from "../../application/service/external_identity_provider";
import { parseGoogleIdTokenClaims } from "./google_id_token_claims";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;

export class GoogleIdentityProvider implements ExternalIdentityProvider {
  #clientId: string;
  #clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
  }

  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
    const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("redirect_uri", input.redirect_uri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.code_challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }

  async exchangeCode(
    input: ExchangeCodeInput
  ): Promise<ExternalIdentityExchangeResult> {
    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: input.code,
          client_id: this.#clientId,
          client_secret: this.#clientSecret,
          redirect_uri: input.redirect_uri,
          grant_type: "authorization_code",
          code_verifier: input.code_verifier,
        }),
        signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, failure: { reason: "token_exchange_failed" } };
    }

    if (!response.ok) {
      return { ok: false, failure: { reason: "token_exchange_failed" } };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, failure: { reason: "token_exchange_failed" } };
    }

    const idToken =
      typeof body === "object" && body !== null && "id_token" in body
        ? (body as { id_token: unknown }).id_token
        : undefined;

    if (typeof idToken !== "string") {
      return { ok: false, failure: { reason: "token_exchange_failed" } };
    }

    const identity = parseGoogleIdTokenClaims(idToken, this.#clientId);

    if (!identity) {
      return { ok: false, failure: { reason: "claims_invalid" } };
    }

    return { ok: true, identity };
  }
}
