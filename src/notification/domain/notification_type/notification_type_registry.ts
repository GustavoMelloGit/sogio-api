export const NOTIFICATION_CHANNELS = ["email"] as const;

export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationTypeRegistryEntry = {
  key: string;
  label: string;
  default_channels: readonly NotificationChannelKey[];
  optional: boolean;
};

export const NOTIFICATION_TYPE_REGISTRY = [
  {
    key: "subscription_payment_failed",
    label: "Falha no pagamento da assinatura",
    default_channels: ["email"],
    optional: false,
  },
] as const satisfies readonly NotificationTypeRegistryEntry[];

export type NotificationTypeKey =
  (typeof NOTIFICATION_TYPE_REGISTRY)[number]["key"];

export function notificationTypeEntryOf(
  key: string
): NotificationTypeRegistryEntry | null {
  return NOTIFICATION_TYPE_REGISTRY.find(entry => entry.key === key) ?? null;
}

export function isNotificationChannel(
  value: string
): value is NotificationChannelKey {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}
