import { describe, it, expect, beforeEach } from "bun:test";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { api } from "../helpers/server";
import {
  FakeEmailService,
  SilentLogger,
  extractResetTokenFromEmail,
} from "../helpers/fixtures/password_reset";
import { AuthPostgresRepository } from "../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { PasswordResetRequestPostgresRepository } from "../../src/auth/infra/database/postgres_repository/password_reset_request_postgres_repository";
import { CryptoDelegatedSecretService } from "../../src/auth/infra/service/crypto_delegated_secret_service";
import { BunHasher } from "../../src/auth/infra/service/bun_hasher";
import { RequestPasswordResetUseCase } from "../../src/auth/application/use_case/request_password_reset";
import { ResetPasswordUseCase } from "../../src/auth/application/use_case/reset_password";

const REQUEST_TTL_MS = 60 * 60 * 1000;
const FRONT_BASE_URL = "http://localhost:5173";

/**
 * The real `ResendEmailService` must never be exercised in tests (D6's
 * plan explicitly calls this out) — every use case here is wired with
 * `FakeEmailService` instead of going through `AuthDi`/HTTP.
 */
function makeRequestUseCase(emailService: FakeEmailService) {
  return new RequestPasswordResetUseCase(
    new AuthPostgresRepository(),
    new PasswordResetRequestPostgresRepository(),
    new CryptoDelegatedSecretService(),
    emailService,
    new SilentLogger(),
    REQUEST_TTL_MS,
    FRONT_BASE_URL
  );
}

function makeResetUseCase() {
  return new ResetPasswordUseCase(
    new AuthPostgresRepository(),
    new PasswordResetRequestPostgresRepository(),
    new CryptoDelegatedSecretService(),
    new BunHasher()
  );
}

describe("Password recovery by email", () => {
  beforeEach(async () => {
    await truncate(["password_reset_requests", "users"]);
  });

  describe("RequestPasswordResetUseCase — indistinguishability (R1/R2)", () => {
    it("responds identically for an existing and a non-existing email", async () => {
      await createUserFixture({
        name: "Ada Lovelace",
        email: "ada@sogio.dev",
        password: "correct-horse-battery",
      });

      const useCase = makeRequestUseCase(new FakeEmailService());

      const forExisting = await useCase.execute({ email: "ada@sogio.dev" });
      const forNonExisting = await useCase.execute({
        email: "ghost@sogio.dev",
      });

      expect(forExisting).toEqual(forNonExisting);
    });

    it("responds identically whether the quota is available or already exceeded", async () => {
      const { user } = await createUserFixture({
        name: "Ada Lovelace",
        email: "ada@sogio.dev",
        password: "correct-horse-battery",
      });

      const useCase = makeRequestUseCase(new FakeEmailService());

      const firstAttempt = await useCase.execute({ email: user.email });
      await useCase.execute({ email: user.email });
      await useCase.execute({ email: user.email });
      // 4th attempt — the monthly limit (3) was already reached
      const fourthAttempt = await useCase.execute({ email: user.email });

      expect(fourthAttempt).toEqual(firstAttempt);
    });

    it("responds identically across existing-success, non-existing, and quota-exceeded", async () => {
      const { user } = await createUserFixture({
        name: "Ada Lovelace",
        email: "ada@sogio.dev",
        password: "correct-horse-battery",
      });

      const useCase = makeRequestUseCase(new FakeEmailService());

      const successOutput = await useCase.execute({ email: user.email });
      const nonExistingOutput = await useCase.execute({
        email: "ghost@sogio.dev",
      });
      await useCase.execute({ email: user.email });
      await useCase.execute({ email: user.email });
      const quotaExceededOutput = await useCase.execute({
        email: user.email,
      });

      expect(nonExistingOutput).toEqual(successOutput);
      expect(quotaExceededOutput).toEqual(successOutput);
    });
  });

  describe("Monthly quota", () => {
    it("the 4th request in the window is silently refused — no new usable token is issued", async () => {
      const { user } = await createUserFixture({
        name: "Ada Lovelace",
        email: "ada@sogio.dev",
        password: "correct-horse-battery",
      });

      const emailService = new FakeEmailService();
      const useCase = makeRequestUseCase(emailService);
      const repository = new PasswordResetRequestPostgresRepository();

      await useCase.execute({ email: user.email });
      await useCase.execute({ email: user.email });
      await useCase.execute({ email: user.email });
      expect(emailService.sentMessages).toHaveLength(3);

      const thirdToken = extractResetTokenFromEmail(
        emailService.sentMessages[2]!
      );

      await useCase.execute({ email: user.email });

      // no 4th email was ever sent, and no 4th request was ever persisted
      expect(emailService.sentMessages).toHaveLength(3);
      const requestsInWindow = await repository.countByUserSince(
        user.id,
        new Date(0)
      );
      expect(requestsInWindow).toBe(3);

      // the last token issued before the quota was hit is still usable
      const resetUseCase = makeResetUseCase();
      await resetUseCase.execute({
        token: thirdToken,
        newPassword: "PosQuota123",
      });

      const signInRes = await api("/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({ email: user.email, password: "PosQuota123" }),
      });
      expect(signInRes.status).toBe(200);
    });
  });

  describe("R6 — issuing a new request invalidates the previous pending one", () => {
    it("rejects the earlier token once a newer request has been issued", async () => {
      const { user } = await createUserFixture({
        name: "Ada Lovelace",
        email: "ada@sogio.dev",
        password: "correct-horse-battery",
      });

      const emailService = new FakeEmailService();
      const useCase = makeRequestUseCase(emailService);

      await useCase.execute({ email: user.email });
      const firstToken = extractResetTokenFromEmail(
        emailService.sentMessages[0]!
      );

      await useCase.execute({ email: user.email });

      const resetUseCase = makeResetUseCase();
      await expect(
        resetUseCase.execute({
          token: firstToken,
          newPassword: "ShouldFail123",
        })
      ).rejects.toThrow("Invalid or expired password reset token");
    });
  });

  describe("Full happy path", () => {
    it("request -> reset -> sign in with the new password (old password stops working)", async () => {
      const { user } = await createUserFixture({
        name: "Ada Lovelace",
        email: "ada@sogio.dev",
        password: "correct-horse-battery",
      });

      const emailService = new FakeEmailService();
      const requestUseCase = makeRequestUseCase(emailService);
      await requestUseCase.execute({ email: user.email });

      const token = extractResetTokenFromEmail(emailService.sentMessages[0]!);

      const resetUseCase = makeResetUseCase();
      await resetUseCase.execute({ token, newPassword: "NovaSenha123" });

      const signInWithNewPassword = await api("/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({ email: user.email, password: "NovaSenha123" }),
      });
      expect(signInWithNewPassword.status).toBe(200);

      const signInWithOldPassword = await api("/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({
          email: user.email,
          password: "correct-horse-battery",
        }),
      });
      expect(signInWithOldPassword.status).toBe(401);
    });
  });

  describe("ResetPasswordUseCase — invalid token (R9)", () => {
    it("rejects an unknown token with a generic error", async () => {
      const resetUseCase = makeResetUseCase();

      await expect(
        resetUseCase.execute({
          token: "unknown-token",
          newPassword: "NovaSenha123",
        })
      ).rejects.toThrow("Invalid or expired password reset token");
    });

    it("rejects an already-consumed token with the exact same generic error", async () => {
      const { user } = await createUserFixture({
        name: "Ada Lovelace",
        email: "ada@sogio.dev",
        password: "correct-horse-battery",
      });

      const emailService = new FakeEmailService();
      const requestUseCase = makeRequestUseCase(emailService);
      await requestUseCase.execute({ email: user.email });
      const token = extractResetTokenFromEmail(emailService.sentMessages[0]!);

      const resetUseCase = makeResetUseCase();
      await resetUseCase.execute({ token, newPassword: "NovaSenha123" });

      await expect(
        resetUseCase.execute({ token, newPassword: "OutraSenha456" })
      ).rejects.toThrow("Invalid or expired password reset token");
    });
  });
});
