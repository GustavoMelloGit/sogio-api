/**
 * Shared by `ExchangeAuthorizationCodeUseCase` and `RefreshAccessTokenUseCase`
 * so `TokenController` has one shape to translate into the spec's response
 * body regardless of which grant produced it.
 *
 * `"invalid_grant"` is deliberately the only failure variant either use case
 * ever returns: risk #4 in the MCP OAuth authorization plan requires that a
 * nonexistent code, an expired one, one issued to another application, a
 * wrong PKCE verifier, a mismatched redirect_uri, a revoked refresh token,
 * and a reused one all be *indistinguishable* to the caller. Collapsing
 * every one of those causes into this single outcome, this early, is what
 * makes that guarantee structural rather than something each call site has
 * to remember.
 */
export type TokenExchangeResult =
  | {
      outcome: "success";
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      scope: string;
    }
  | { outcome: "invalid_grant" };
