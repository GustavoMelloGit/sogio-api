export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain-text body — always required as the fallback for clients that don't render HTML. */
  text: string;
  /** Optional rich rendering; the composer decides whether a message needs one. */
  html?: string;
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
