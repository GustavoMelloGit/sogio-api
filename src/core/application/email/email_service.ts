export type EmailMessage = {
  to: string;
  subject: string;
  body: string;
};

/**
 * Deliberately burra — recipient, subject, body. Auth's password recovery
 * message and any future BC's email both flow through this same contract;
 * knowledge of what an email is *about* belongs to whoever composes the
 * `EmailMessage`, never to this port.
 */
export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}
