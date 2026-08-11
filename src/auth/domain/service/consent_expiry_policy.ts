import type { Consent } from "../entity/delegated_access/consent";

/**
 * E9 — vida absoluta e expiração por inatividade do Consentimento. The
 * project has no scheduler/cron (see `RegisterAppUseCase` for the
 * established "piggyback on traffic" purge pattern used elsewhere); for
 * these two rules specifically, a periodic sweep isn't the right shape at
 * all, because they have to hold on the *verification* path itself — an
 * agent still actively calling `/mcp` must stop authenticating the moment
 * its Consent crosses either threshold, not whenever some future job
 * happens to run. `OAuthCredentialVerifier` evaluates this on every
 * verification; `ListConnectedAppsUseCase` evaluates it too, since an
 * abandoned app that never calls `/mcp` again would otherwise never trip
 * the verifier and would linger on the connected-apps screen forever.
 *
 * `granted_at` is never reset by a reconnection (task 10) — it is the age
 * of the original grant, not of the last time the app was used. `last_used_at`
 * is touched by every successful credential verification and by the
 * reconnection shortcut, so inactivity measures time since genuine last use.
 */
export function isConsentExpired(
  consent: Pick<Consent, "granted_at" | "last_used_at">,
  absoluteLifetimeMs: number,
  inactivityTtlMs: number,
  now: Date = new Date()
): boolean {
  const nowMs = now.getTime();

  return (
    nowMs - consent.granted_at.getTime() >= absoluteLifetimeMs ||
    nowMs - consent.last_used_at.getTime() >= inactivityTtlMs
  );
}
