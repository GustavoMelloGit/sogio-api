import { z } from "zod";
import type { UseCase } from "../../../core/application/use_case/use_case";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import { ValidationError } from "../../../core/application/error/validation_error";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { SubscriptionStatus } from "../../domain/entity/subscription";
import { BillingCyclePolicy } from "../../domain/policy/billing_cycle_policy";
import { SubscriptionPaymentFailedEvent } from "../../domain/event/subscription_payment_failed_event";

type Input = {
  user_id: string;
  /** Opaque gateway decline code (snake_case) — never free text or an error message. */
  reason?: string | null;
  /** The gateway event's own timestamp (DA-8) — recorded as external_event_at so a later out-of-order event can be compared against it. */
  occurred_at?: Date;
};

/** Opaque snake_case decline code from the payment gateway, e.g. `card_declined`. */
const reasonSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9_]+$/);

type Output = {
  id: string;
  status: SubscriptionStatus;
  grace_period_ends_at: Date | null;
};

/**
 * The real caller `markPastDue` was missing (DA-5) — this is the shape the
 * payment gateway's payment-failure webhook invokes. No HTTP route: marking
 * an account past due by hand is an operational lever, not a product surface.
 */
export class MarkSubscriptionPastDueUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly eventDispatcher: EventDispatcher
  ) {}

  async execute(input: Input): Promise<Output> {
    if (input.reason && !reasonSchema.safeParse(input.reason).success) {
      throw new ValidationError(
        "reason must be an opaque snake_case gateway code up to 120 characters"
      );
    }

    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      input.user_id
    );
    if (!subscription) {
      throw new ResourceNotFoundError("Subscription");
    }

    const gracePeriodEndsAt = BillingCyclePolicy.gracePeriodEnd(new Date());

    subscription.markPastDue(gracePeriodEndsAt, {
      external_event_at: input.occurred_at,
    });
    await this.subscriptionRepository.save(subscription);

    await this.eventDispatcher.dispatch(
      new SubscriptionPaymentFailedEvent({
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        plan_id: subscription.plan_id,
        grace_period_ends_at: gracePeriodEndsAt,
        reason: input.reason ?? null,
      })
    );

    return {
      id: subscription.id,
      status: subscription.status,
      grace_period_ends_at: subscription.grace_period_ends_at,
    };
  }
}
