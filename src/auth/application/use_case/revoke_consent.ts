import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../domain/entity/user";
import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";

export type RevokeConsentInput = {
  consentId: string;
};

/**
 * The mechanism invariant 5 depends on — "o usuário desconecta um
 * aplicativo → todas as credenciais daquele aplicativo deixam de valer
 * imediatamente" — delivered here for task 14's "connected apps" screen to
 * call. This task adds no endpoint and no controller; only this use case
 * and its DI wiring (`AuthDi.makeRevokeConsentUseCase`).
 *
 * **Consistency without a cross-repository transaction.** This subdomain
 * has no unit-of-work abstraction spanning `ConsentRepository` and
 * `IssuedCredentialRepository` — the only `db.transaction` in it,
 * `IssuedCredentialPostgresRepository.rotateRefreshToken`, is entirely
 * internal to that one repository and never crosses into `Consent`.
 * Ordering is therefore the only guarantee available, chosen so the
 * forbidden window — a Consent that reads as revoked while a credential
 * under it is still usable — can never open, even if the process dies
 * between the two statements:
 *
 * 1. `issuedCredentialRepository.revokeAllByConsent` first. Until this
 *    completes, the Consent still reads as active — the *safe* direction,
 *    since nothing yet claims to have revoked anything.
 * 2. `consentRepository.revoke` second. By the time any reader can observe
 *    the Consent as revoked, every credential under it already carries its
 *    own `revoked_at` — exactly what invariant 5 requires.
 *
 * A crash between the two leaves credentials revoked but the Consent still
 * (incorrectly) reading as active — the opposite of the forbidden window,
 * and self-healing: calling this again re-runs step 1 as a no-op
 * (`revokeAllByConsent` only touches rows where `revoked_at IS NULL`) and
 * completes step 2. The reverse order was rejected precisely because its
 * only failure mode is the forbidden one.
 *
 * **Ownership is enforced here, not deferred to task 14's controller.** A
 * Consent that doesn't belong to `user` is answered identically to one
 * that doesn't exist at all (`ResourceNotFoundError`) — the same
 * not-found/not-yours collapsing convention `UpdatePropertyUseCase` and
 * `CancelStayUseCase` already use elsewhere in this codebase. "A lista
 * mostra apenas os aplicativos do próprio usuário" is an authorization
 * invariant the plan states explicitly, not a UI filter a future
 * controller could get away with skipping.
 */
export class RevokeConsentUseCase implements UseCase<RevokeConsentInput, void> {
  constructor(
    private readonly consentRepository: ConsentRepository,
    private readonly issuedCredentialRepository: IssuedCredentialRepository
  ) {}

  async execute(input: RevokeConsentInput, user: User): Promise<void> {
    const consent = await this.consentRepository.findById(input.consentId);

    if (!consent || consent.user_id !== user.id) {
      throw new ResourceNotFoundError("Consent");
    }

    if (consent.revoked_at) {
      return;
    }

    await this.issuedCredentialRepository.revokeAllByConsent(consent.id);
    await this.consentRepository.revoke(consent.id);
  }
}
