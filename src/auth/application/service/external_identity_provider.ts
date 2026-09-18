export type AttestedIdentity = {
  subject: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  nonce: string | null;
};

export type ExternalIdentityExchangeFailure = {
  reason: "token_exchange_failed" | "claims_invalid";
};

export type ExternalIdentityExchangeResult =
  | { ok: true; identity: AttestedIdentity }
  | { ok: false; failure: ExternalIdentityExchangeFailure };

export type BuildAuthorizationUrlInput = {
  state: string;
  nonce: string;
  code_challenge: string;
  redirect_uri: string;
};

export type ExchangeCodeInput = {
  code: string;
  code_verifier: string;
  redirect_uri: string;
};

export interface ExternalIdentityProvider {
  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string;
  exchangeCode(
    input: ExchangeCodeInput
  ): Promise<ExternalIdentityExchangeResult>;
}
