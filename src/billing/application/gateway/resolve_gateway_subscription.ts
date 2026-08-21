import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { Subscription } from "../../domain/entity/subscription";

type GatewayReferences = {
  external_reference: string;
  external_customer_reference: string;
};

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

export async function resolveGatewaySubscriptionForTermination(
  subscriptionRepository: SubscriptionRepository,
  event: GatewayReferences
): Promise<Subscription | null> {
  return subscriptionRepository.subscriptionOfExternalReference(
    event.external_reference
  );
}

export function isStaleGatewayEvent(
  subscription: Subscription,
  occurredAt: Date
): boolean {
  return (
    !!subscription.external_event_at &&
    occurredAt < subscription.external_event_at
  );
}
