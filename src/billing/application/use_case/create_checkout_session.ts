import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import { ValidationError } from "../../../core/application/error/validation_error";
import { ConflictError } from "../../../core/application/error/conflict_error";
import { IllegalStateError } from "../../../core/application/error/illegal_state_error";
import type { PlanRepository } from "../../domain/repository/plan_repository";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { PaymentGateway } from "../gateway/payment_gateway";

type Input = {
  plan_code: string;
};

type Output = {
  url: string;
};

const SUCCESS_PATH = "/settings/billing?checkout=success";
const CANCEL_PATH = "/settings/billing?checkout=canceled";

const LIVE_GATEWAY_STATUSES = new Set(["trialing", "active", "past_due"]);

export class CreateCheckoutSessionUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly planRepository: PlanRepository,
    private readonly paymentGateway: PaymentGateway,
    private readonly frontBaseUrl: string
  ) {}

  async execute(input: Input, user: User): Promise<Output> {
    const plan = await this.planRepository.planOfCode(input.plan_code);
    if (!plan || plan.deleted_at) {
      throw new ResourceNotFoundError("Plan");
    }

    if (plan.is_perpetual) {
      throw new ValidationError("The Free plan has no checkout");
    }

    if (!plan.external_price_reference) {
      throw new IllegalStateError(
        `Plan ${plan.code} has no external_price_reference configured`
      );
    }

    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) {
      throw new ResourceNotFoundError("Subscription");
    }

    if (
      subscription.external_reference &&
      LIVE_GATEWAY_STATUSES.has(subscription.status)
    ) {
      throw new ConflictError(
        "A gateway subscription is already live — manage it through the billing portal instead"
      );
    }

    const externalCustomerReference = subscription.external_customer_reference
      ? subscription.external_customer_reference
      : await this.#createAndLinkCustomer(subscription.id, user);

    const session = await this.paymentGateway.createCheckoutSession({
      external_customer_reference: externalCustomerReference,
      external_price_reference: plan.external_price_reference,
      client_reference_id: user.id,
      success_url: `${this.frontBaseUrl}${SUCCESS_PATH}`,
      cancel_url: `${this.frontBaseUrl}${CANCEL_PATH}`,
      // Only offered to a subscription that has never used a trial (§2.5,
      // R-5) — the invariant Subscription.startTrial enforces on its own
      // isn't enough by itself, since the gateway would grant the trial
      // before our sync ever sees it.
      trial_period_days:
        subscription.trial_ends_at === null && plan.trial_days > 0
          ? plan.trial_days
          : undefined,
    });

    return { url: session.url };
  }

  async #createAndLinkCustomer(
    subscriptionId: string,
    user: User
  ): Promise<string> {
    const created = await this.paymentGateway.createCustomer({
      user_id: user.id,
      email: user.email,
    });

    return this.subscriptionRepository.linkCustomerReferenceIfAbsent(
      subscriptionId,
      created
    );
  }
}
