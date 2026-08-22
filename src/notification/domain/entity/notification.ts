import { z } from "zod";
import { baseEntitySchema } from "../../../core/domain/entity/base_entity";
import { IllegalStateError } from "../../../core/application/error/illegal_state_error";
import { NOTIFICATION_CHANNELS } from "../notification_type/notification_type_registry";

export const MAX_DELIVERY_ATTEMPTS = 5;

export const notificationStatusSchema = z.enum(["pending", "sent", "failed"]);

export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export const notificationSchema = baseEntitySchema.extend({
  user_id: z.uuidv4(),
  type: z.string().min(1).max(100),
  channel: z.enum(NOTIFICATION_CHANNELS),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  status: notificationStatusSchema,
  attempts: z.int().min(0).max(MAX_DELIVERY_ATTEMPTS),
  scheduled_for: z.date().nullable(),
  next_attempt_at: z.date(),
  sent_at: z.date().nullable(),
  read_at: z.date().nullable(),
  last_error: z.string().max(500).nullable(),
});

export type NotificationData = z.infer<typeof notificationSchema>;

type CreateInput = {
  user_id: string;
  type: string;
  channel: NotificationData["channel"];
  title: string;
  body: string;
  scheduled_for?: Date | null;
};

/**
 * @kind Entity, Aggregate Root
 */
export class Notification {
  readonly #data: NotificationData;

  private constructor(data: NotificationData) {
    this.#data = notificationSchema.parse(data);
  }

  static #nextId(): string {
    return crypto.randomUUID();
  }

  public static create(input: CreateInput): Notification {
    const now = new Date();
    const scheduledFor = input.scheduled_for ?? null;

    return new Notification({
      id: this.#nextId(),
      created_at: now,
      updated_at: now,
      user_id: input.user_id,
      type: input.type,
      channel: input.channel,
      title: input.title,
      body: input.body,
      status: "pending",
      attempts: 0,
      scheduled_for: scheduledFor,
      next_attempt_at: scheduledFor ?? now,
      sent_at: null,
      read_at: null,
      last_error: null,
    });
  }

  public static reconstitute(data: NotificationData): Notification {
    return new Notification(data);
  }

  public markSent(): void {
    if (this.#data.status === "sent") {
      return;
    }

    const now = new Date();
    this.#data.status = "sent";
    this.#data.sent_at = now;
    this.#data.updated_at = now;
    this.#data.last_error = null;
  }

  public markFailed(error: string): void {
    if (this.#data.status === "sent") {
      throw new IllegalStateError("Cannot fail a notification already sent");
    }

    const now = new Date();
    const attempts = this.#data.attempts + 1;

    this.#data.attempts = attempts;
    this.#data.updated_at = now;
    this.#data.last_error = error.slice(0, 500);

    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      this.#data.status = "failed";
      return;
    }

    this.#data.status = "pending";
    this.#data.next_attempt_at = new Date(
      now.getTime() + 60_000 * 2 ** (attempts - 1)
    );
  }

  public markRead(): void {
    if (this.#data.read_at) {
      return;
    }

    const now = new Date();
    this.#data.read_at = now;
    this.#data.updated_at = now;
  }

  get data(): NotificationData {
    return this.#data;
  }

  get id() {
    return this.#data.id;
  }

  get user_id() {
    return this.#data.user_id;
  }

  get type() {
    return this.#data.type;
  }

  get channel() {
    return this.#data.channel;
  }

  get title() {
    return this.#data.title;
  }

  get body() {
    return this.#data.body;
  }

  get status() {
    return this.#data.status;
  }

  get attempts() {
    return this.#data.attempts;
  }

  get scheduled_for() {
    return this.#data.scheduled_for;
  }

  get next_attempt_at() {
    return this.#data.next_attempt_at;
  }

  get sent_at() {
    return this.#data.sent_at;
  }

  get read_at() {
    return this.#data.read_at;
  }

  get last_error() {
    return this.#data.last_error;
  }

  get created_at() {
    return this.#data.created_at;
  }

  get updated_at() {
    return this.#data.updated_at;
  }

  get deleted_at() {
    return this.#data.deleted_at;
  }
}
