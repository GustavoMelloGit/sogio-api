import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../domain/entity/user";
import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";
import { revokeConsentCascade } from "../service/consent_cascade";

export type RevokeConsentInput = {
  consentId: string;
};

/**
 * The mechanism invariant 5 depends on — "o usuário desconecta um
 * aplicativo → todas as credenciais daquele aplicativo deixam de valer
 * imediatamente" — consumed by task 14's "connected apps" screen
 * (`DisconnectAppController`) directly, with no cascade logic of its own:
 * the actual two-step revocation (credentials, then Consent) lives in
 * `revokeConsentCascade`, shared with revocation-on-expiry (E9,
 * `OAuthCredentialVerifier`/`ListConnectedAppsUseCase`) — see that
 * function's doc for the full ordering rationale and why it's
 * self-healing across a crash between the two steps.
 *
 * **Ownership is enforced here, not deferred to the controller.** A
 * Consent that doesn't belong to `user` is answered identically to one
 * that doesn't exist at all (`ResourceNotFoundError`) — the same
 * not-found/not-yours collapsing convention `UpdatePropertyUseCase` and
 * `CancelStayUseCase` already use elsewhere in this codebase. "A lista
 * mostra apenas os aplicativos do próprio usuário" is an authorization
 * invariant the plan states explicitly, not a UI filter the controller
 * could get away with skipping.
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

    await revokeConsentCascade(
      consent.id,
      this.consentRepository,
      this.issuedCredentialRepository
    );
  }
}
