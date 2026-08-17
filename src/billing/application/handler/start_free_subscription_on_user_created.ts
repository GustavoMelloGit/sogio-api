import type { UserCreatedEvent } from "../../../auth/domain/event/user_created_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import { EnsureFreeSubscriptionUseCase } from "../use_case/ensure_free_subscription";

export class StartFreeSubscriptionOnUserCreated
  implements EventHandler<UserCreatedEvent>
{
  constructor(
    private readonly logger: Logger,
    private readonly ensureFreeSubscriptionUseCase: EnsureFreeSubscriptionUseCase
  ) {}

  async handle(event: UserCreatedEvent): Promise<void> {
    this.logger.info("User created - ensuring Free subscription", {
      event: event,
      userId: event.user_id,
    });

    await this.ensureFreeSubscriptionUseCase.execute({
      user_id: event.user_id,
    });
  }
}
