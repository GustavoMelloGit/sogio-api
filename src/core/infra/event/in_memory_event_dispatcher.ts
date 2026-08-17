// src/core/infra/event/in-memory-event-dispatcher.ts

import type { EventDispatcher } from "../../application/event/event_dispatcher";
import type { EventHandler } from "../../application/event/event_handler";
import type { DomainEvent } from "../../domain/event/domain_event";
import type { Logger } from "../../application/logger/logger";
import { ConsoleLogger } from "../logger/console_logger";

class InMemoryEventDispatcher implements EventDispatcher {
  private handlers: Map<string, EventHandler<DomainEvent>[]> = new Map();

  constructor(private readonly logger: Logger) {}

  register(eventName: string, handler: EventHandler<DomainEvent>): void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName)!.push(handler);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const eventName = event.name;
    const handlers = this.handlers.get(eventName);

    if (handlers) {
      this.logger.info(
        `Dispatching event ${eventName} to ${handlers.length} handler(s).`,
        { eventName, handlerCount: handlers.length }
      );
      await Promise.all(handlers.map(handler => handler.handle(event)));
    }
  }

  /**
   * Introspection kept off the `EventDispatcher` port on purpose — only the
   * concrete singleton exposes it, for tests that lock an invariant about
   * what's registered for an event. Exists for R-15: `DeletePropertyUseCase`'s
   * "tudo ou nada" transaction (DA-13) only covers every effect of its
   * cascade because, today, `StayCanceledEvent` has exactly one handler and
   * it only writes to Postgres. A test asserting that count should fail
   * loudly the day a second handler with an external effect is registered,
   * instead of the transaction silently stopping covering "tudo".
   */
  handlerCountFor(eventName: string): number {
    return this.handlers.get(eventName)?.length ?? 0;
  }
}

export const inMemoryEventDispatcher = new InMemoryEventDispatcher(
  new ConsoleLogger()
);
