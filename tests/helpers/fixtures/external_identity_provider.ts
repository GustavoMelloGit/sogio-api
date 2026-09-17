import type {
  AttestedIdentity,
  BuildAuthorizationUrlInput,
  ExchangeCodeInput,
  ExternalIdentityExchangeFailure,
  ExternalIdentityExchangeResult,
  ExternalIdentityProvider,
} from "../../../src/auth/application/service/external_identity_provider";

export function attestedIdentityFixture(
  overrides: Partial<AttestedIdentity> = {}
): AttestedIdentity {
  return {
    subject: `google-subject-${crypto.randomUUID()}`,
    email: `google-user-${crypto.randomUUID()}@sogio.dev`,
    email_verified: true,
    name: "Ada Lovelace",
    nonce: null,
    ...overrides,
  };
}

export class FakeExternalIdentityProvider implements ExternalIdentityProvider {
  #result: ExternalIdentityExchangeResult = {
    ok: true,
    identity: attestedIdentityFixture(),
  };
  #lastExchangeCodeInput: ExchangeCodeInput | null = null;
  #lastBuildAuthorizationUrlInput: BuildAuthorizationUrlInput | null = null;

  respondWithIdentity(overrides: Partial<AttestedIdentity> = {}): void {
    this.#result = { ok: true, identity: attestedIdentityFixture(overrides) };
  }

  respondWithFailure(reason: ExternalIdentityExchangeFailure["reason"]): void {
    this.#result = { ok: false, failure: { reason } };
  }

  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
    this.#lastBuildAuthorizationUrlInput = input;

    const url = new URL("https://fake-google.test/o/oauth2/v2/auth");
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.code_challenge);
    url.searchParams.set("redirect_uri", input.redirect_uri);
    return url.toString();
  }

  async exchangeCode(
    input: ExchangeCodeInput
  ): Promise<ExternalIdentityExchangeResult> {
    this.#lastExchangeCodeInput = input;
    return this.#result;
  }

  get lastExchangeCodeInput(): ExchangeCodeInput | null {
    return this.#lastExchangeCodeInput;
  }

  get lastBuildAuthorizationUrlInput(): BuildAuthorizationUrlInput | null {
    return this.#lastBuildAuthorizationUrlInput;
  }
}
