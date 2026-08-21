import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import { ConflictError } from "../../../core/application/error/conflict_error";
import type { SubscriptionRepository } from "../../domain/repository/subscription_repository";
import type { PaymentGateway } from "../gateway/payment_gateway";

type Input = Record<string, never>;

type Output = {
  url: string;
};

const RETURN_PATH = "/settings/billing?portal=return";

export class CreateBillingPortalSessionUseCase
  implements UseCase<Input, Output>
{
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly paymentGateway: PaymentGateway,
    private readonly frontBaseUrl: string
  ) {}

  async execute(_input: Input, user: User): Promise<Output> {
    const subscription = await this.subscriptionRepository.subscriptionOfUser(
      user.id
    );
    if (!subscription) {
      throw new ResourceNotFoundError("Subscription");
    }

    if (!subscription.external_customer_reference) {
      throw new ConflictError(
        "This account has no gateway customer yet — start a checkout first"
      );
    }

    const session = await this.paymentGateway.createBillingPortalSession({
      external_customer_reference: subscription.external_customer_reference,
      return_url: `${this.frontBaseUrl}${RETURN_PATH}`,
    });

    return { url: session.url };
  }
}
