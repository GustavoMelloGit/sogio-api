import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { Subscription } from "../../domain/entity/subscription";

type GatewayReferences = {
  external_reference: string;
  external_customer_reference: string;
};

/**
 * Shared by every webhook path that must find "which local subscription
 * does this gateway event belong to" (DA-9). Tries the subscription
 * reference first; the customer-reference fallback is what makes the very
 * first sync after checkout resolvable at all — the local row only has
 * `external_customer_reference` until this call sets `external_reference`.
 */
export async function resolveGatewaySubscription(
  subscriptionRepository: SubscriptionRepository,
  event: GatewayReferences
): Promise<Subscription | null> {
  const byReference =
    await subscriptionRepository.subscriptionOfExternalReference(
      event.external_reference
    );
  if (byReference) return byReference;

  return subscriptionRepository.subscriptionOfExternalCustomerReference(
    event.external_customer_reference
  );
}

/**
 * The termination-safe variant (security review B-3/B-4/B-5) — the only
 * resolver every destructive transition (cancel, markPastDue) may use. The
 * customer-reference fallback above is what makes B-3/B-4/B-5 possible: it
 * can hand back a *different*, still-valid local subscription for the same
 * gateway customer (e.g. a resubscription after a failed checkout, or an
 * unrelated Free row that was never linked). A termination transition can
 * never safely act on such a match, so this function simply never attempts
 * the fallback — there is no dangerous `Subscription` for a caller to
 * receive and no per-call-site check to remember. Every path that used to
 * copy an `external_reference` comparison after `resolveGatewaySubscription`
 * should call this instead.
 */
export async function resolveGatewaySubscriptionForTermination(
  subscriptionRepository: SubscriptionRepository,
  event: GatewayReferences
): Promise<Subscription | null> {
  return subscriptionRepository.subscriptionOfExternalReference(
    event.external_reference
  );
}

// KNOWN DEBT (security review, B-3/B-4 follow-up): this watermark is global per local Subscription row, not per external_reference — an out-of-order event for a superseded/new gateway subscription can be wrongly discarded if a later-clocked event for a different gateway subscription already advanced it on the same row.
/** The DA-8 out-of-order guard: an event older than the last one applied is discarded. */
export function isStaleGatewayEvent(
  subscription: Subscription,
  occurredAt: Date
): boolean {
  return (
    !!subscription.external_event_at &&
    occurredAt < subscription.external_event_at
  );
}
