import { SubscriptionEntitlementService } from "../../src/billing/application/service/subscription_entitlement_service";
import { PlanPostgresRepository } from "../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { SubscriptionPostgresRepository } from "../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import type { EntitlementService } from "../../src/billing/application/service/entitlement_service";

export function makeTestEntitlementService(): EntitlementService {
  return new SubscriptionEntitlementService(
    new SubscriptionPostgresRepository(),
    new PlanPostgresRepository()
  );
}
