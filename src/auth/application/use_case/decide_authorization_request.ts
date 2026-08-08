import { AuthorizationCode } from "../../domain/entity/delegated_access/authorization_code";
import { Consent } from "../../domain/entity/delegated_access/consent";
import type { User } from "../../domain/entity/user";
import type { AppRegistrationRepository } from "../../domain/repository/delegated_access/app_registration_repository";
import type { AuthorizationCodeRepository } from "../../domain/repository/delegated_access/authorization_code_repository";
import type { AuthorizationRequestRepository } from "../../domain/repository/delegated_access/authorization_request_repository";
import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { revokeConsentCascadeIfNotAlreadyRevoked } from "../service/consent_cascade";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";
import type { UseCase } from "../../../core/application/use_case/use_case";

export type AuthorizationDecision = "approve" | "deny";

export type DecideAuthorizationRequestInput = {
  identifier: string;
  decision: AuthorizationDecision;
};

export type DecideAuthorizationRequestResult =
  | { outcome: "not_found" }
  | {
      outcome: "redirect";
      decision: AuthorizationDecision;
      clientId: string;
      location: string;
    };

/**
 * A code's whole purpose is to be exchanged within the time it takes the
 * browser to follow one redirect back to the client — seconds, not
 * minutes (Decisão Resolvida #8).
 */
const AUTHORIZATION_CODE_TTL_MS = 60 * 1000;

const ACCESS_DENIED_DESCRIPTION = "The user denied the authorization request.";

/**
 * Approve or deny a Pending Authorization Request (task 10, contract step
 * 6) — and, unchanged, the endpoint the reconnection shortcut calls
 * silently: same path, same atomic claim, no separate endpoint (see the
 * plan's "Contrato com o stayhub-front").
 *
 * The request's one-shot claim (E4) is a single atomic
 * `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING`
 * (`AuthorizationRequestRepository.claim`) — never a `SELECT` followed by
 * an `UPDATE`. Zero rows back means "doesn't exist, already expired, or
 * already used", indistinguishable to the caller: Mode A (E2), no
 * redirect of any kind, not even an error one — the Pending Authorization
 * Request is the only proof `/authorize`'s validation ever happened, and a
 * dead one proves nothing. Both approving and denying reach this same
 * claim, so either decision consumes the request exactly once.
 *
 * Denying returns the *registered* redirect URI (never anything the
 * caller supplied) with `error=access_denied` and the request's own
 * `state` echoed literally. No Consent is written and no code is minted.
 *
 * Approving registers or reuses the Consent for (user, app): an existing,
 * *usable* Consent (`Consent#isUsable` — neither revoked nor expired by E9,
 * Achado 3 da revisão pós-implementação) is reused and only has its
 * `last_used_at` touched. A nonexistent one gets a brand-new row. A revoked
 * or E9-expired one is *not* reused, but it's not a second row either
 * (Achado 1): `(user_id, app_registration_id)` now has a unique index, so
 * this decision revives that same row as a fresh grant, with its own
 * `granted_at` — after first cascading away anything still live under it
 * (`revokeConsentCascadeIfNotAlreadyRevoked`), so a grant that lapsed by E9
 * without ever being touched by the verifier or the connected-apps screen
 * can't hand a brand-new authorization code back its own stale credentials.
 * The scope carried onto the Consent and the
 * Authorization Code is always the one `/authorize` already validated on
 * the request, never re-derived from this call's input. The Authorization
 * Code inherits the request's `redirect_uri`, `code_challenge`, `scope`,
 * and `resource` untouched, for `/token` (task 11) to revalidate against
 * whatever the client presents there (E3).
 *
 * `user` is who is authenticated *right now*, on the app's own session —
 * never anything carried over from whoever started the flow. That is what
 * makes this the point of consent, not a replay of someone else's intent.
 */
export class DecideAuthorizationRequestUseCase
  implements
    UseCase<DecideAuthorizationRequestInput, DecideAuthorizationRequestResult>
{
  constructor(
    private readonly authorizationRequestRepository: AuthorizationRequestRepository,
    private readonly appRegistrationRepository: AppRegistrationRepository,
    private readonly consentRepository: ConsentRepository,
    private readonly authorizationCodeRepository: AuthorizationCodeRepository,
    private readonly issuedCredentialRepository: IssuedCredentialRepository,
    private readonly secretService: DelegatedSecretService,
    private readonly consentAbsoluteLifetimeMs: number,
    private readonly consentInactivityTtlMs: number
  ) {}

  async execute(
    input: DecideAuthorizationRequestInput,
    user: User
  ): Promise<DecideAuthorizationRequestResult> {
    const claimed = await this.authorizationRequestRepository.claim(
      this.secretService.digest(input.identifier)
    );
    if (!claimed) {
      return { outcome: "not_found" };
    }

    const appRegistration = await this.appRegistrationRepository.findById(
      claimed.app_registration_id
    );
    if (!appRegistration) {
      return { outcome: "not_found" };
    }

    if (input.decision === "deny") {
      return {
        outcome: "redirect",
        decision: "deny",
        clientId: appRegistration.id,
        location: this.#buildRedirect(claimed.redirect_uri, claimed.state, {
          error: "access_denied",
          errorDescription: ACCESS_DENIED_DESCRIPTION,
        }),
      };
    }

    const consentId = await this.#resolveConsent(
      user.id,
      appRegistration.id,
      claimed.scope
    );

    const { secret, digest } = this.secretService.generate();

    const authorizationCode = AuthorizationCode.create({
      code_digest: digest,
      app_registration_id: appRegistration.id,
      consent_id: consentId,
      redirect_uri: claimed.redirect_uri,
      code_challenge: claimed.code_challenge,
      code_challenge_method: claimed.code_challenge_method,
      scope: claimed.scope,
      resource: claimed.resource,
      expires_at: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
    });
    await this.authorizationCodeRepository.create(authorizationCode);

    return {
      outcome: "redirect",
      decision: "approve",
      clientId: appRegistration.id,
      location: this.#buildRedirect(claimed.redirect_uri, claimed.state, {
        code: secret,
      }),
    };
  }

  async #resolveConsent(
    userId: string,
    appRegistrationId: string,
    scope: string
  ): Promise<string> {
    const existing = await this.consentRepository.findByUserAndApp(
      userId,
      appRegistrationId
    );

    if (!existing) {
      const now = new Date();
      const consent = Consent.create({
        user_id: userId,
        app_registration_id: appRegistrationId,
        scope,
        granted_at: now,
        last_used_at: now,
      });
      const saved = await this.consentRepository.create(consent);
      return saved.id;
    }

    if (
      existing.isUsable(
        this.consentAbsoluteLifetimeMs,
        this.consentInactivityTtlMs
      )
    ) {
      await this.consentRepository.touchLastUsedAt(existing.id);
      return existing.id;
    }

    await revokeConsentCascadeIfNotAlreadyRevoked(
      existing,
      this.consentRepository,
      this.issuedCredentialRepository
    );
    const grantedAt = new Date();
    await this.consentRepository.revive(existing.id, scope, grantedAt);
    return existing.id;
  }

  #buildRedirect(
    redirectUri: string,
    state: string | null | undefined,
    outcome: { code?: string; error?: string; errorDescription?: string }
  ): string {
    const url = new URL(redirectUri);
    if (outcome.code !== undefined) {
      url.searchParams.set("code", outcome.code);
    }
    if (outcome.error !== undefined) {
      url.searchParams.set("error", outcome.error);
    }
    if (outcome.errorDescription !== undefined) {
      url.searchParams.set("error_description", outcome.errorDescription);
    }
    if (state !== undefined && state !== null) {
      url.searchParams.set("state", state);
    }
    return url.toString();
  }
}
