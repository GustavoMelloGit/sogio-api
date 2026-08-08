import { IssuedCredential } from "../../domain/entity/delegated_access/issued_credential";
import type { AuthorizationCodeRepository } from "../../domain/repository/delegated_access/authorization_code_repository";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { redirectUriMatches } from "../../domain/service/redirect_uri_policy";
import { verifyPkceS256 } from "../../domain/service/pkce_policy";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { TokenExchangeResult } from "./token_exchange_result";

export type ExchangeAuthorizationCodeInput = {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  /**
   * The canonical `/mcp` resource URL, computed by the controller (mirrors
   * `InitiateAuthorizationUseCase`'s `expectedResource` — this use case
   * never reaches into the presentation controller that owns
   * `MCP_RESOURCE_PATH`).
   */
  expectedResource: string;
};

/**
 * `grant_type=authorization_code` (task 11) — the second half of the flow
 * `DecideAuthorizationRequestUseCase` (task 10) started by minting the
 * code. Every failure branch below returns the same generic
 * `{ outcome: "invalid_grant" }` (see `TokenExchangeResult`'s docstring):
 * `TokenController` turns that into one fixed OAuth error, so a nonexistent
 * code, an expired one, one issued to another client, a mismatched
 * redirect_uri, and a wrong PKCE verifier are answered identically (risk #4).
 *
 * **Reivindicação atômica e reuso (E4).** `AuthorizationCodeRepository.claim`
 * is the single `UPDATE ... WHERE consumed_at IS NULL RETURNING` — never a
 * `SELECT` then an `UPDATE`. Zero rows back means "doesn't exist or was
 * already consumed," and per the plan's explicit correction (not the
 * `AuthorizationRequestRepository.claim` fix from task 10 — that one
 * doesn't apply here on purpose): this `claim` intentionally does **not**
 * filter on `expires_at`, because a code that's expired but was *never*
 * used must return its (single) row so the caller can tell "expired" apart
 * from "reused" — only the latter revokes anything. Zero rows here is
 * therefore always treated as presumed reuse: `AuthorizationCode` doesn't
 * record which family it minted, so the only way to find it is
 * `IssuedCredentialRepository.findByAuthorizationCodeDigest` — a credential
 * exists with this digest only if a *prior* exchange of this exact code
 * already succeeded. Found means genuine replay, so `revokeFamily` on that
 * family (never the Consent — E4). Not found means this code either never
 * existed or was claimed once already but failed validation before
 * minting anything (e.g. wrong PKCE on its only real attempt) — nothing
 * was ever issued, so there is nothing to revoke.
 *
 * A row *is* returned but `expires_at` is in the past: plain `invalid_grant`,
 * evaluated on that row, no reuse handling — this is not a replay, it's the
 * code's only (late) presentation.
 *
 * **E3 revalidation.** `claimed.app_registration_id` must equal the
 * presented `client_id` and `redirectUriMatches(claimed.redirect_uri,
 * input.redirectUri)` must hold — a code minted for one application is not
 * redeemable by another, correct verifier or not.
 *
 * **Resource binding (RFC 8707).** The issued credential's `resource` is
 * `claimed.resource`, carried unchanged from the code (itself carried
 * unchanged from the Pending Authorization Request `/authorize` already
 * validated against the canonical `/mcp` URL) — re-checked here against
 * `expectedResource` as defense in depth, not because `/authorize` could
 * plausibly have let anything else through.
 */
export class ExchangeAuthorizationCodeUseCase
  implements UseCase<ExchangeAuthorizationCodeInput, TokenExchangeResult>
{
  constructor(
    private readonly authorizationCodeRepository: AuthorizationCodeRepository,
    private readonly issuedCredentialRepository: IssuedCredentialRepository,
    private readonly secretService: DelegatedSecretService,
    private readonly accessTokenTtlMs: number,
    private readonly refreshTokenTtlMs: number
  ) {}

  async execute(
    input: ExchangeAuthorizationCodeInput
  ): Promise<TokenExchangeResult> {
    const codeDigest = this.secretService.digest(input.code);
    const claimed = await this.authorizationCodeRepository.claim(codeDigest);

    if (!claimed) {
      await this.#revokeFamilyIfAlreadyIssued(codeDigest);
      return { outcome: "invalid_grant" };
    }

    if (claimed.expires_at.getTime() <= Date.now()) {
      return { outcome: "invalid_grant" };
    }

    if (claimed.app_registration_id !== input.clientId) {
      return { outcome: "invalid_grant" };
    }

    if (!redirectUriMatches(claimed.redirect_uri, input.redirectUri)) {
      return { outcome: "invalid_grant" };
    }

    if (claimed.resource !== input.expectedResource) {
      return { outcome: "invalid_grant" };
    }

    if (!verifyPkceS256(input.codeVerifier, claimed.code_challenge)) {
      return { outcome: "invalid_grant" };
    }

    const familyId = crypto.randomUUID();
    const access = this.secretService.generate();
    const refresh = this.secretService.generate();
    const now = Date.now();

    const credential = IssuedCredential.create({
      consent_id: claimed.consent_id,
      family_id: familyId,
      access_token_digest: access.digest,
      access_token_expires_at: new Date(now + this.accessTokenTtlMs),
      refresh_token_digest: refresh.digest,
      refresh_token_expires_at: new Date(now + this.refreshTokenTtlMs),
      resource: claimed.resource,
      authorization_code_digest: codeDigest,
    });

    await this.issuedCredentialRepository.issue(credential);

    return {
      outcome: "success",
      accessToken: access.secret,
      refreshToken: refresh.secret,
      expiresIn: Math.floor(this.accessTokenTtlMs / 1000),
      scope: claimed.scope,
    };
  }

  async #revokeFamilyIfAlreadyIssued(codeDigest: string): Promise<void> {
    const alreadyIssued =
      await this.issuedCredentialRepository.findByAuthorizationCodeDigest(
        codeDigest
      );

    if (alreadyIssued) {
      await this.issuedCredentialRepository.revokeFamily(
        alreadyIssued.family_id
      );
    }
  }
}
