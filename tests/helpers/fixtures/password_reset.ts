import type {
  EmailMessage,
  EmailService,
} from "../../../src/core/application/email/email_service";
import type { Logger } from "../../../src/core/application/logger/logger";

/**
 * The Resend adapter must never be exercised in tests (real network, real
 * cost). Use cases depend on the `EmailService` port, so tests inject this
 * in-memory double instead — it also lets tests recover the plaintext token
 * that only ever leaves the use case inside the composed email body.
 */
export class FakeEmailService implements EmailService {
  sentMessages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sentMessages.push(message);
  }
}

export class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  fatal(): void {}
}

export function extractResetTokenFromEmail(message: EmailMessage): string {
  const match = message.body.match(/token=(\S+)/);

  if (!match?.[1]) {
    throw new Error("No reset token found in the composed email body");
  }

  return decodeURIComponent(match[1]);
}
