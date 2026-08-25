import { z } from "zod";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPE_KEYS,
} from "../../domain/notification_type/notification_type_registry";

export const updateNotificationPreferencesInput = {
  type: z
    .enum(NOTIFICATION_TYPE_KEYS)
    .describe(
      `Notification type key. One of: ${NOTIFICATION_TYPE_KEYS.join(", ")}.`
    ),
  channel: z
    .enum(NOTIFICATION_CHANNELS)
    .describe(
      `Delivery channel for this preference. One of: ${NOTIFICATION_CHANNELS.join(", ")}.`
    ),
  enabled: z
    .boolean()
    .describe("Whether this notification should be delivered on this channel."),
} satisfies z.ZodRawShape;
