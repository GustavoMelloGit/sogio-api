import { sql } from "drizzle-orm";
import { db } from "./core/infra/database/drizzle/database";
import { env } from "./core/infra/config/environments";
import { bunServeOptions } from "./core/infra/http/routes/routes";
import { CoreDi } from "./core/infra/di/core_di";
import type { Logger } from "./core/application/logger/logger";
import { NotificationDi } from "./notification/infra/di/notification_di";
import { SessionPostgresRepository } from "./auth/infra/database/postgres_repository/session_postgres_repository";
import { sessionInactivityTtlMs } from "./core/infra/config/environments";

async function checkDatabaseConnection(logger: Logger) {
  try {
    await db.execute(sql`SELECT 1`);
    logger.info(
      "✅ Connection to the database has been successfully verified."
    );
  } catch (error) {
    logger.error("❌ Unable to connect to the database", { error });
    process.exit(1);
  }
}

async function main() {
  const coreDi = new CoreDi();
  const logger = coreDi.makeLogger();

  await checkDatabaseConnection(logger);

  const server = Bun.serve({
    ...bunServeOptions,
    port: env.PORT,
    hostname: env.SERVER_HOSTNAME,
  });

  const isProduction = env.NODE_ENV === "production";
  const baseUrl = env.API_BASE_URL ?? `http://localhost:${server.port}`;
  logger.info(
    isProduction
      ? `🚀 API running in production mode`
      : `🚀 Listening on ${baseUrl}`,
    {
      port: server.port,
      environment: env.NODE_ENV,
      hostname: env.SERVER_HOSTNAME,
    }
  );
  logger.info(`📖 API docs: ${baseUrl}/docs`);
  logger.info(`📄 OpenAPI JSON: ${baseUrl}/docs/spec`);

  startNotificationDelivery(logger);
  startSessionCleanup(logger);
}

/**
 * Sessão vencida não vira faxina para depois (E9): a linha morta sai sozinha.
 * A varredura é horária e nunca apaga sessão viva — só o que já passou da
 * vida absoluta, que o `AuthMiddleware` de qualquer forma já recusa.
 */
const REVOKED_SESSION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function startSessionCleanup(logger: Logger) {
  const sessionRepository = new SessionPostgresRepository();

  const timer = setInterval(
    async () => {
      try {
        const deleted = await sessionRepository.deleteExpired(
          new Date(),
          sessionInactivityTtlMs,
          REVOKED_SESSION_GRACE_MS
        );

        if (deleted > 0) {
          logger.info("Expired sessions pruned", { deleted });
        }
      } catch (error) {
        logger.error("Session cleanup run crashed", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
      }
    },
    60 * 60 * 1000
  );

  timer.unref();
}

function startNotificationDelivery(logger: Logger) {
  const notificationDi = new NotificationDi();
  const useCase = notificationDi.makeDeliverPendingNotificationsUseCase();
  const intervalMs = env.NOTIFICATION_DELIVERY_INTERVAL_SECONDS * 1000;
  let running = false;

  const timer = setInterval(async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      const result = await useCase.execute({
        limit: env.NOTIFICATION_DELIVERY_BATCH_SIZE,
      });

      if (result.delivered > 0 || result.failed > 0) {
        logger.info("Notification delivery run finished", result);
      }
    } catch (error) {
      logger.error("Notification delivery run crashed", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
    } finally {
      running = false;
    }
  }, intervalMs);

  timer.unref();

  logger.info("🔔 Notification delivery scheduled", {
    interval_seconds: env.NOTIFICATION_DELIVERY_INTERVAL_SECONDS,
    batch_size: env.NOTIFICATION_DELIVERY_BATCH_SIZE,
  });
}

main();
