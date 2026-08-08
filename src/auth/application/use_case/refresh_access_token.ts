import { IssuedCredential } from "../../domain/entity/delegated_access/issued_credential";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import type { RefreshRotationGraceCache } from "../../domain/service/refresh_rotation_grace_cache";
import { OAUTH_MCP_SCOPE } from "../../domain/service/oauth_scope_policy";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { TokenExchangeResult } from "./token_exchange_result";

export type RefreshAccessTokenInput = {
  refreshToken: string;
};

/**
 * `grant_type=refresh_token` (task 11). `scope` in the v1 response is
 * always `OAUTH_MCP_SCOPE` directly rather than looked up through
 * `Consent` — every consent, code, and credential in this system carries
 * that same single supported scope (Decisão Resolvida #3), so a join back
 * to `Consent` here would only ever confirm what's already known.
 *
 * **Rotation (E4).** `IssuedCredentialRepository.rotateRefreshToken` is the
 * atomic claim: it inserts the successor and reivindica the current row's
 * `refresh_token_digest` in one transaction, rolling both back together if
 * the row was already rotated or revoked out from under this call. A `null`
 * return means exactly that race was lost — this refetches the row to see
 * which of the two states it lost to.
 *
 * **Grace window (E4).** A refresh token whose `rotated_at` is already set
 * is a superseded one. Within `graceWindowMs` of that timestamp, this
 * returns the *same* successor a prior winning call already minted — never
 * a new one, which is why the winner stashes those clear-text secrets in
 * `RefreshRotationGraceCache` (see its docstring for why that's necessary
 * at all: the DB only ever holds a digest). Past the window — or within it
 * but with no cached payload left to return (a rare, benign edge case, e.g.
 * a process restart) — this is `invalid_grant`; only the *elapsed* case
 * additionally revokes the family, since a cache miss inside the window
 * isn't evidence of anything, just an inability to honor the request.
 *
 * A refresh token presented more than one generation behind the active tip
 * naturally gets no grace: its own `rotated_at` reflects the moment *it*
 * was superseded, and the cache entry keyed to it (populated only at that
 * moment, with the same short TTL) will already have expired by the time
 * any realistic client-driven refresh cadence reaches it.
 */
export class RefreshAccessTokenUseCase
  implements UseCase<RefreshAccessTokenInput, TokenExchangeResult>
{
  constructor(
    private readonly issuedCredentialRepository: IssuedCredentialRepository,
    private readonly secretService: DelegatedSecretService,
    private readonly graceCache: RefreshRotationGraceCache,
    private readonly accessTokenTtlMs: number,
    private readonly refreshTokenTtlMs: number,
    private readonly graceWindowMs: number
  ) {}

  async execute(input: RefreshAccessTokenInput): Promise<TokenExchangeResult> {
    const presentedDigest = this.secretService.digest(input.refreshToken);
    const current =
      await this.issuedCredentialRepository.findByRefreshTokenDigest(
        presentedDigest
      );

    if (!current) {
      return { outcome: "invalid_grant" };
    }

    if (
      current.revoked_at ||
      current.refresh_token_expires_at.getTime() <= Date.now()
    ) {
      return { outcome: "invalid_grant" };
    }

    if (!current.rotated_at) {
      return this.#rotate(presentedDigest, current);
    }

    return this.#handleAlreadyRotated(presentedDigest, current);
  }

  async #rotate(
    presentedDigest: string,
    current: IssuedCredential
  ): Promise<TokenExchangeResult> {
    const access = this.secretService.generate();
    const refresh = this.secretService.generate();
    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + this.accessTokenTtlMs);

    const successor = IssuedCredential.create({
      consent_id: current.consent_id,
      family_id: current.family_id,
      access_token_digest: access.digest,
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_digest: refresh.digest,
      refresh_token_expires_at: new Date(now + this.refreshTokenTtlMs),
      resource: current.resource,
    });

    const rotated = await this.issuedCredentialRepository.rotateRefreshToken(
      presentedDigest,
      successor
    );

    if (!rotated) {
      const refetched =
        await this.issuedCredentialRepository.findByRefreshTokenDigest(
          presentedDigest
        );

      if (refetched?.rotated_at) {
        return this.#handleAlreadyRotated(presentedDigest, refetched);
      }

      return { outcome: "invalid_grant" };
    }

    this.graceCache.put(
      presentedDigest,
      {
        accessToken: access.secret,
        refreshToken: refresh.secret,
        accessTokenExpiresAt,
        scope: OAUTH_MCP_SCOPE,
      },
      this.graceWindowMs
    );

    return {
      outcome: "success",
      accessToken: access.secret,
      refreshToken: refresh.secret,
      expiresIn: Math.floor(this.accessTokenTtlMs / 1000),
      scope: OAUTH_MCP_SCOPE,
    };
  }

  async #handleAlreadyRotated(
    presentedDigest: string,
    current: IssuedCredential
  ): Promise<TokenExchangeResult> {
    const rotatedAt = current.rotated_at;
    if (!rotatedAt) {
      return { outcome: "invalid_grant" };
    }

    const elapsedMs = Date.now() - rotatedAt.getTime();

    if (elapsedMs > this.graceWindowMs) {
      await this.issuedCredentialRepository.revokeFamily(current.family_id);
      return { outcome: "invalid_grant" };
    }

    const payload = this.graceCache.get(presentedDigest);
    if (!payload) {
      return { outcome: "invalid_grant" };
    }

    return {
      outcome: "success",
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresIn: Math.max(
        0,
        Math.round((payload.accessTokenExpiresAt.getTime() - Date.now()) / 1000)
      ),
      scope: payload.scope,
    };
  }
}
