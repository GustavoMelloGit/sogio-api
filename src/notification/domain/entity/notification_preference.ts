import { z } from "zod";
import { baseEntitySchema } from "../../../core/domain/entity/base_entity";
import { NOTIFICATION_CHANNELS } from "../notification_type/notification_type_registry";

export const notificationPreferenceSchema = baseEntitySchema.extend({
  user_id: z.uuidv4(),
  type: z.string().min(1).max(100),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});

export type NotificationPreferenceData = z.infer<
  typeof notificationPreferenceSchema
>;

/**
 * @kind Entity, Aggregate Root
 */
export class NotificationPreference {
  readonly #data: NotificationPreferenceData;

  private constructor(data: NotificationPreferenceData) {
    this.#data = notificationPreferenceSchema.parse(data);
  }

  public static create(input: {
    user_id: string;
    type: string;
    channel: NotificationPreferenceData["channel"];
    enabled: boolean;
  }): NotificationPreference {
    const now = new Date();

    return new NotificationPreference({
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      ...input,
    });
  }

  public static reconstitute(
    data: NotificationPreferenceData
  ): NotificationPreference {
    return new NotificationPreference(data);
  }

  public changeTo(enabled: boolean): void {
    this.#data.enabled = enabled;
    this.#data.updated_at = new Date();
  }

  get data(): NotificationPreferenceData {
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

  get enabled() {
    return this.#data.enabled;
  }
}
