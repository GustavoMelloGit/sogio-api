export type NotifyInput = {
  user_id: string;
  type: string;
  title: string;
  body: string;
  scheduled_for?: Date | null;
};

export interface NotificationService {
  notify(input: NotifyInput): Promise<void>;
}
