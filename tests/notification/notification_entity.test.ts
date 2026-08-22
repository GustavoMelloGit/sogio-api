import { describe, it, expect } from "bun:test";
import {
  Notification,
  MAX_DELIVERY_ATTEMPTS,
} from "../../src/notification/domain/entity/notification";
import { IllegalStateError } from "../../src/core/application/error/illegal_state_error";

function pendingNotification(): Notification {
  return Notification.create({
    user_id: crypto.randomUUID(),
    type: "subscription_payment_failed",
    channel: "email",
    title: "Falha no pagamento",
    body: "Regularize sua assinatura.",
  });
}

describe("Notification persisted schema", () => {
  it("still reconstitutes a row whose type was removed from the registry", () => {
    const now = new Date();

    const notification = Notification.reconstitute({
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      user_id: crypto.randomUUID(),
      type: "a_type_that_no_longer_exists",
      channel: "email",
      title: "Histórico antigo",
      body: "Uma notificação de um tipo já aposentado.",
      status: "sent",
      attempts: 1,
      scheduled_for: null,
      next_attempt_at: now,
      sent_at: now,
      read_at: null,
      last_error: null,
    });

    expect(notification.type).toBe("a_type_that_no_longer_exists");
  });
});

describe("Notification.markRead", () => {
  it("refuses to mark a pending notification as read", () => {
    const notification = pendingNotification();

    expect(() => notification.markRead()).toThrow(IllegalStateError);
    expect(notification.read_at).toBeNull();
  });

  it("refuses to mark a failed notification as read", () => {
    const notification = pendingNotification();

    for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
      notification.markFailed("smtp is down");
    }
    expect(notification.status).toBe("failed");

    expect(() => notification.markRead()).toThrow(IllegalStateError);
    expect(notification.read_at).toBeNull();
  });

  it("marks a sent notification as read", () => {
    const notification = pendingNotification();
    notification.markSent();

    notification.markRead();

    expect(notification.read_at).not.toBeNull();
  });

  it("is idempotent — reading twice keeps the first timestamp", () => {
    const notification = pendingNotification();
    notification.markSent();

    notification.markRead();
    const firstRead = notification.read_at;
    notification.markRead();

    expect(notification.read_at).toBe(firstRead);
  });

  it("refuses to fail a notification already sent", () => {
    const notification = pendingNotification();
    notification.markSent();

    expect(() => notification.markFailed("too late")).toThrow(
      IllegalStateError
    );
  });
});
