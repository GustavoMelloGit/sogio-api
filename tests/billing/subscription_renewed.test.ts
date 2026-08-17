import { describe, it, expect } from "bun:test";
import { SubscriptionHistoryEntry } from "../../src/billing/domain/entity/subscription_history_entry";
import { SubscriptionRenewedEvent } from "../../src/billing/domain/event/subscription_renewed_event";
import { RecordHistoryOnSubscriptionRenewed } from "../../src/billing/application/handler/record_history_on_subscription_renewed";
import type { RecordSubscriptionHistoryEntryUseCase } from "../../src/billing/application/use_case/record_subscription_history_entry";

const base = {
  subscription_id: "b3f6c1a0-0000-4000-8000-000000000001",
  user_id: "b3f6c1a0-0000-4000-8000-000000000002",
  plan_id: "b3f6c1a0-0000-4000-8000-000000000003",
  occurred_at: new Date("2026-06-15T12:00:00.000Z"),
};

describe("SubscriptionHistoryEntry — renewed refinement (§2.6)", () => {
  it("requires resulting_status active for a renewed entry", () => {
    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "renewed",
        resulting_status: "trialing",
        access_until: null,
      })
    ).toThrow();
  });

  it("accepts a well-formed renewed entry", () => {
    expect(() =>
      SubscriptionHistoryEntry.record({
        ...base,
        type: "renewed",
        resulting_status: "active",
        access_until: new Date("2026-07-15T12:00:00.000Z"),
      })
    ).not.toThrow();
  });
});

describe("RecordHistoryOnSubscriptionRenewed", () => {
  it("records a renewed entry with resulting_status active and access_until = current_period_end", async () => {
    const calls: unknown[] = [];
    const stubUseCase = {
      execute: async (input: unknown) => {
        calls.push(input);
      },
    } as unknown as RecordSubscriptionHistoryEntryUseCase;

    const handler = new RecordHistoryOnSubscriptionRenewed(stubUseCase);
    const periodEnd = new Date("2026-07-15T12:00:00.000Z");

    await handler.handle(
      new SubscriptionRenewedEvent({
        subscription_id: base.subscription_id,
        user_id: base.user_id,
        plan_id: base.plan_id,
        current_period_end: periodEnd,
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      subscription_id: base.subscription_id,
      type: "renewed",
      resulting_status: "active",
      access_until: periodEnd,
    });
  });
});
