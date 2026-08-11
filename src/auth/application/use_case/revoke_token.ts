import type { IssuedCredential } from "../../domain/entity/delegated_access/issued_credential";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";
import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import type { UseCase } from "../../../core/application/use_case/use_case";

export type RevocableTokenType = "access_token" | "refresh_token";

export type RevokeTokenInput = {
  token: string;
  tokenTypeHint?: RevocableTokenType;
  clientId?: string;
};

/**
 * Never surfaced to the caller of `/revoke` — RFC 7009 §2.2 makes this
 * endpoint deliberately not an oracle, so `RevokeController` answers `200`
 * the same way regardless of which of these occurred. This type exists so
 * the controller can still log a *result* (E7's allowlist permits it)
 * without that log revealing anything the HTTP response doesn't already
 * reveal to the caller — which is nothing.
 */
export type RevokeTokenResult = {
  outcome: "revoked" | "not_found" | "client_mismatch";
};

type Located = {
  credential: IssuedCredential;
  type: RevocableTokenType;
};

/**
 * `POST /revoke` (task 12, RFC 7009). Revocation is idempotent: a token
 * that doesn't exist, is already expired, or is already revoked all reach
 * `{ outcome: "not_found" }` or a no-op `revokeById`/`revokeFamily` call —
 * never an error, never a different HTTP status.
 *
 * **Lookup order, not lookup gate.** `token_type_hint` only decides which
 * digest lookup runs *first* — it never gates which one runs at all. A
 * wrong hint still finds the token on the second lookup (RFC 7009 §2.1:
 * "the authorization server MAY ignore this parameter, particularly if it
 * is able to detect the token type automatically"). Without a hint, access
 * token is tried first, mirroring the RFC's own example order.
 *
 * **Authorization.** The presented token proves only *possession* — a
 * random opaque value carrying no identity of its own. `client_id` is
 * optional here, unlike `/token`: RFC 7009 doesn't require it for a public
 * client, since holding the token is already the ordinary proof of
 * authority to revoke it. When `client_id` *is* presented, though, it must
 * match the application the located credential's Consent belongs to — a
 * mismatch skips revocation entirely (`outcome: "client_mismatch"`)
 * without ever telling the caller that's what happened; one application
 * can never revoke another's credential this way, correct token value or
 * not.
 *
 * **Scope of revocation.** An access token found here revokes only that
 * one credential (`revokeById`) — its sibling refresh token and the rest
 * of the family keep working. A refresh token found here revokes the
 * whole family (`revokeFamily`), the same unit `RefreshAccessTokenUseCase`
 * already revokes on reuse (E4) — a refresh token's scope of authority is
 * the family it roots. Neither path ever touches the Consent: that stays
 * reserved for explicit user action (`RevokeConsentUseCase`) or E9 expiry
 * (invariant 6).
 */
export class RevokeTokenUseCase
  implements UseCase<RevokeTokenInput, RevokeTokenResult>
{
  constructor(
    private readonly issuedCredentialRepository: IssuedCredentialRepository,
    private readonly consentRepository: ConsentRepository,
    private readonly secretService: DelegatedSecretService
  ) {}

  async execute(input: RevokeTokenInput): Promise<RevokeTokenResult> {
    const digest = this.secretService.digest(input.token);
    const located = await this.#locate(digest, input.tokenTypeHint);

    if (!located) {
      return { outcome: "not_found" };
    }

    if (input.clientId) {
      const authorized = await this.#belongsToClient(
        located.credential,
        input.clientId
      );
      if (!authorized) {
        return { outcome: "client_mismatch" };
      }
    }

    if (located.type === "refresh_token") {
      await this.issuedCredentialRepository.revokeFamily(
        located.credential.family_id
      );
    } else {
      await this.issuedCredentialRepository.revokeById(located.credential.id);
    }

    return { outcome: "revoked" };
  }

  async #belongsToClient(
    credential: IssuedCredential,
    clientId: string
  ): Promise<boolean> {
    const consent = await this.consentRepository.findById(
      credential.consent_id
    );
    return consent !== null && consent.app_registration_id === clientId;
  }

  async #locate(
    digest: string,
    hint: RevocableTokenType | undefined
  ): Promise<Located | null> {
    const order: RevocableTokenType[] =
      hint === "refresh_token"
        ? ["refresh_token", "access_token"]
        : ["access_token", "refresh_token"];

    for (const type of order) {
      const credential = await this.#findByType(digest, type);
      if (credential) {
        return { credential, type };
      }
    }

    return null;
  }

  async #findByType(
    digest: string,
    type: RevocableTokenType
  ): Promise<IssuedCredential | null> {
    return type === "access_token"
      ? this.issuedCredentialRepository.findByAccessTokenDigest(digest)
      : this.issuedCredentialRepository.findByRefreshTokenDigest(digest);
  }
}
