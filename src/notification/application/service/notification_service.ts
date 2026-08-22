import type { NotificationTypeKey } from "../../domain/notification_type/notification_type_registry";

export type NotifyInput = {
  user_id: string;
  type: NotificationTypeKey;
  /**
   * Os fatos do evento, independentes de idioma. Nunca texto: o conteúdo é
   * renderizado na entrega, no idioma que o destinatário escolheu.
   */
  payload: Record<string, unknown>;
  scheduled_for?: Date | null;
};

export interface NotificationService {
  notify(input: NotifyInput): Promise<void>;
}
