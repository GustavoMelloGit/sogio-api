import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";

type Input = {
  user_id: string;
  external_customer_reference: string;
};

type Output = void;

/**
 * Handles the `checkout_completed` path (DA-9) — `client_reference_id` is
 * our own `user_id`, used only to link identity, never to grant anything by
 * itself. In the normal flow `CreateCheckoutSessionUseCase` already linked
 * the customer atomically (DA-6) before the session existed, so this call
 * is usually a no-op; it exists as the safety net the design calls for
 * (DA-2 item 5).
 */
export class BindGatewayCustomerUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: Input): Promise<Output> {
    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      input.user_id
    );
    if (!subscription) {
      this.logger.error(
        "checkout_completed for a user with no local subscription",
        { user_id: input.user_id }
      );
      return;
    }

    try {
      subscription.linkCustomer(input.external_customer_reference);
    } catch (error) {
      // DA-3: no ConflictError may escape the webhook path. A genuine
      // conflict here is a data-integrity signal for a human, not something
      // a gateway retry could ever fix.
      this.logger.error(
        "checkout_completed customer reference conflicts with an already-linked one",
        {
          subscription_id: subscription.id,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        }
      );
      return;
    }

    await this.subscriptionRepository.save(subscription);
  }
}
