import { z } from "zod";
import type { Locale } from "../../../core/domain/locale/locale";

export const NOTIFICATION_CHANNELS = ["email"] as const;

export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationContent = {
  title: string;
  body: string;
};

export type NotificationFormatters = {
  date(value: Date): string;
};

type ContentFactory<Payload> = (
  payload: Payload,
  format: NotificationFormatters
) => NotificationContent;

/**
 * Um tipo de notificação declara três coisas na mesma entrada: o que ele
 * carrega (`payload`), como se chama (`label`) e o que diz (`content`) — em
 * todos os idiomas suportados. `label` e `content` são `Record<Locale, ...>`
 * totais de propósito: adicionar um idioma a `SUPPORTED_LOCALES` sem traduzir
 * um tipo existente é erro de compilação, não uma notificação que sai no
 * idioma errado em produção.
 */
type NotificationTypeInput<Key extends string, Schema extends z.ZodType> = {
  key: Key;
  label: Record<Locale, string>;
  default_channels: readonly NotificationChannelKey[];
  optional: boolean;
  payload: Schema;
  content: Record<Locale, ContentFactory<z.infer<Schema>>>;
};

export type NotificationTypeRegistryEntry = {
  key: string;
  label: Record<Locale, string>;
  default_channels: readonly NotificationChannelKey[];
  optional: boolean;
  /** `null` quando o payload persistido não satisfaz o contrato do tipo. */
  render(
    data: unknown,
    locale: Locale,
    format: NotificationFormatters
  ): NotificationContent | null;
  /** Mensagem do primeiro problema encontrado, ou `null` quando válido. */
  payloadError(data: unknown): string | null;
};

/**
 * Fecha o payload sobre o conteúdo no ponto em que os dois são escritos, de
 * modo que o registro exponha uma forma única (`render`) mesmo sendo uma
 * união de tipos com payloads diferentes.
 */
function defineNotificationType<Key extends string, Schema extends z.ZodType>(
  input: NotificationTypeInput<Key, Schema>
) {
  return {
    key: input.key,
    label: input.label,
    default_channels: input.default_channels,
    optional: input.optional,
    render(
      data: unknown,
      locale: Locale,
      format: NotificationFormatters
    ): NotificationContent | null {
      const parsed = input.payload.safeParse(data);

      if (!parsed.success) {
        return null;
      }

      return input.content[locale](parsed.data, format);
    },
    payloadError(data: unknown): string | null {
      const parsed = input.payload.safeParse(data);

      return parsed.success
        ? null
        : (parsed.error.issues[0]?.message ?? "Invalid payload");
    },
  };
}

export const NOTIFICATION_TYPE_REGISTRY = [
  defineNotificationType({
    key: "subscription_payment_failed",
    label: {
      "pt-BR": "Falha no pagamento da assinatura",
      "en-US": "Subscription payment failure",
    },
    default_channels: ["email"],
    optional: false,
    payload: z.object({ grace_period_ends_at: z.coerce.date() }),
    content: {
      "pt-BR": (payload, format) => ({
        title: "Falha no pagamento da sua assinatura",
        body: `Não conseguimos processar o pagamento da sua assinatura. Regularize até ${format.date(payload.grace_period_ends_at)} para não perder o acesso à plataforma.`,
      }),
      "en-US": (payload, format) => ({
        title: "Your subscription payment failed",
        body: `We could not process your subscription payment. Settle it by ${format.date(payload.grace_period_ends_at)} to keep your access to the platform.`,
      }),
    },
  }),
  defineNotificationType({
    key: "subscription_trial_ending",
    label: {
      "pt-BR": "Fim do período de teste",
      "en-US": "Trial ending",
    },
    default_channels: ["email"],
    optional: true,
    payload: z.object({ trial_ends_at: z.coerce.date() }),
    content: {
      "pt-BR": (payload, format) => ({
        title: "Seu período de teste está acabando",
        body: `Seu período de teste termina em ${format.date(payload.trial_ends_at)}. Escolha um plano para continuar com acesso à plataforma.`,
      }),
      "en-US": (payload, format) => ({
        title: "Your trial is ending",
        body: `Your trial ends on ${format.date(payload.trial_ends_at)}. Pick a plan to keep your access to the platform.`,
      }),
    },
  }),
] as const satisfies readonly NotificationTypeRegistryEntry[];

export type NotificationTypeKey =
  (typeof NOTIFICATION_TYPE_REGISTRY)[number]["key"];

export const NOTIFICATION_TYPE_KEYS = NOTIFICATION_TYPE_REGISTRY.map(
  entry => entry.key
) as [NotificationTypeKey, ...NotificationTypeKey[]];

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
