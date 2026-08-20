import { sql } from "drizzle-orm";
import { db } from "./core/infra/database/drizzle/database";
import { env } from "./core/infra/config/environments";
import { bunRoutes, billingDi } from "./core/infra/http/routes/routes";
import { CoreDi } from "./core/infra/di/core_di";
import type { Logger } from "./core/application/logger/logger";

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

/**
 * DA-5: with `plans` empty and the gateway static, no webhook ever fires —
 * this is the only thing that populates the catalog in a fresh environment
 * (or repairs it after missed webhooks). Never fatal: a Stripe outage at
 * deploy time must not keep the API from serving whatever is already in the
 * database. Skipped in `test` (the suite never talks to the network) and in
 * `development` without a Stripe key (nothing to reconcile against) — in
 * both cases `seedPlans()` fixtures the catalog instead (DA-10).
 *
 * S-4: deliberately not awaited by `main()` and called only after
 * `Bun.serve()` — the Stripe SDK's defaults (80s timeout per request, with
 * retries, multiplied by auto-pagination) could otherwise hold up boot for
 * minutes against a slow Stripe, exactly during a `pm2 restart` at deploy
 * time. The server comes up serving whatever catalog is already in the
 * database and this repairs it in the background; errors are still caught
 * and logged here, never left to become an unhandled rejection.
 */
async function reconcilePlanCatalog(logger: Logger) {
  if (env.NODE_ENV === "test" || !env.STRIPE_SECRET_KEY) {
    logger.info(
      "Skipping plan catalog reconciliation (test environment or no STRIPE_SECRET_KEY)"
    );
    return;
  }

  try {
    const result = await billingDi
      .makeReconcilePlanCatalogFromGatewayUseCase()
      .execute();
    logger.info("✅ Plan catalog reconciled from the gateway", result);
  } catch (error) {
    logger.error(
      "❌ Plan catalog reconciliation failed at boot — continuing with whatever is already in the database",
      // Serialized explicitly: a raw Error's message/stack are non-enumerable,
      // so JSON.stringify would log `{}` and hide the cause.
      {
        error: Error.isError(error)
          ? { name: error.name, message: error.message }
          : String(error),
      }
    );
  }
}

async function main() {
  const coreDi = new CoreDi();
  const logger = coreDi.makeLogger();

  await checkDatabaseConnection(logger);

  const server = Bun.serve({
    port: env.PORT,
    routes: bunRoutes,
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

  // S-4: fired after the server is already accepting traffic — see
  // `reconcilePlanCatalog`'s docstring.
  void reconcilePlanCatalog(logger);
}

main();
