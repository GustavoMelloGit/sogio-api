import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";

/**
 * The two-step cascade invariant 5 requires — revoke every derived
 * credential, then the Consent itself — factored out so explicit
 * user-initiated revocation (`RevokeConsentUseCase`) and revocation
 * triggered by expiry (E9 — `OAuthCredentialVerifier` and
 * `ListConnectedAppsUseCase`) share one implementation instead of two
 * copies of the same ordering rationale.
 *
 * Order matters: credentials first, Consent second, so the forbidden
 * window — a Consent that reads as revoked while a credential under it is
 * still usable — can never open, even if the process dies between the two
 * statements. Until the first step completes, the Consent still reads as
 * active — the *safe* direction, since nothing yet claims to have revoked
 * anything. By the time any reader can observe the Consent as revoked,
 * every credential under it already carries its own `revoked_at`. A crash
 * between the two leaves credentials revoked but the Consent still
 * (incorrectly) reading as active — the opposite of the forbidden window,
 * and self-healing: calling this again re-runs the first step as a no-op
 * (`revokeAllByConsent` only touches rows where `revoked_at IS NULL`) and
 * completes the second.
 */
export async function revokeConsentCascade(
  consentId: string,
  consentRepository: ConsentRepository,
  issuedCredentialRepository: IssuedCredentialRepository
): Promise<void> {
  await issuedCredentialRepository.revokeAllByConsent(consentId);
  await consentRepository.revoke(consentId);
}
