import { eq } from "drizzle-orm";
import type {
  EmailMessage,
  EmailService,
} from "../../../src/core/application/email/email_service";
import type { Logger } from "../../../src/core/application/logger/logger";
import { PasswordResetRequest } from "../../../src/auth/domain/entity/password_reset_request";
import { PasswordResetRequestPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/password_reset_request_postgres_repository";
import { CryptoDelegatedSecretService } from "../../../src/auth/infra/service/crypto_delegated_secret_service";
import { db } from "../../../src/core/infra/database/drizzle/database";
import { passwordResetRequestsTable } from "../../../src/core/infra/database/drizzle/schema";

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
  const match = message.text.match(/token=(\S+)/);

  if (!match?.[1]) {
    throw new Error("No reset token found in the composed email body");
  }

  return decodeURIComponent(match[1]);
}

/**
 * Creates a `PasswordResetRequest` and backdates its `created_at` directly
 * in the database — used to reproduce a request that is old enough for its
 * 1h token TTL to have long elapsed, while still sitting inside the 30-day
 * quota window. Exists to test that retention purge is scoped by
 * `created_at` (the quota's own basis), never by `expires_at`.
 */
export async function createBackdatedPasswordResetRequestFixture(input: {
  userId: string;
  createdAt: Date;
}): Promise<void> {
  const repository = new PasswordResetRequestPostgresRepository();
  const secretService = new CryptoDelegatedSecretService();
  const { digest } = secretService.generate();

  const entity = PasswordResetRequest.create({
    user_id: input.userId,
    token_digest: digest,
    expires_at: new Date(input.createdAt.getTime() + 60 * 60 * 1000),
  });

  const saved = await repository.create(entity);

  await db
    .update(passwordResetRequestsTable)
    .set({ created_at: input.createdAt })
    .where(eq(passwordResetRequestsTable.id, saved.id));
}
