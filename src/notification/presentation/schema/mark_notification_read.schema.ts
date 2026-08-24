import { z } from "zod";

export const markNotificationReadInput = {
  notification_id: z
    .uuid("Notification ID must be a valid UUID")
    .describe("The notification's id, as returned by list_notifications."),
} satisfies z.ZodRawShape;
