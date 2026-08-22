import { describe, it, expect } from "bun:test";
import { inMemoryEventDispatcher } from "../../src/core/infra/event/in_memory_event_dispatcher";
import { StayDi } from "../../src/booking/infra/di/stay_di";
import { FinanceDi } from "../../src/finance/infra/di/finance_di";
import { BillingDi } from "../../src/billing/infra/di/billing_di";
import { PropertyDi } from "../../src/booking/infra/di/property_di";
import { NotificationDi } from "../../src/notification/infra/di/notification_di";
import "../helpers/server";

const WIRED_EVENTS = [
  "stay_booked",
  "stay_canceled",
  "user_created",
  "subscription_payment_failed",
];

function handlerCounts(): Record<string, number> {
  return Object.fromEntries(
    WIRED_EVENTS.map(event => [
      event,
      inMemoryEventDispatcher.handlerCountFor(event),
    ])
  );
}

describe("Event handler registration", () => {
  it("wires each handler exactly once through the composition root", () => {
    expect(handlerCounts()).toEqual({
      stay_booked: 2,
      stay_canceled: 1,
      user_created: 1,
      subscription_payment_failed: 2,
    });
  });

  it("never registers a handler from a Di constructor", () => {
    const before = handlerCounts();

    new StayDi();
    new FinanceDi();
    new BillingDi();
    new PropertyDi();
    new NotificationDi();

    expect(handlerCounts()).toEqual(before);
  });
});
