import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
} from "../../../core/presentation/controller/controller";
import type { ReconcilePlanCatalogFromGatewayUseCase } from "../../application/use_case/reconcile_plan_catalog_from_gateway";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const outputSchema = z.object({
  entries_seen: z.int(),
});

/**
 * Admin-only, whole-application scope — operates on the catalog every
 * user shares, never a single user's own data, so per CLAUDE.md/
 * architecture.md it deliberately carries no MCP tool (DA-12).
 *
 * `allowWithoutPlatformAccess: true` is load-bearing, not decorative
 * (DA-5): if the boot-time reconciliation ever fails against an empty
 * `plans` table, the admin's own account is blocked by the very gate this
 * route exists to unblock everyone from — the fix can't sit behind the
 * lock it fixes.
 */
export class SyncPlanCatalogController implements Controller {
  path = "/billing/catalog/sync";
  method = HttpControllerMethod.POST;

  openApiSpec: OpenApiOperation = {
    summary: "Reconcile the plan catalog from the payment gateway",
    description:
      "Reads the entire price catalog from the gateway and applies it to the local plans table (DA-5). Admin only.",
    tags: ["Billing"],
    responses: {
      "200": responseFromZod(
        "Reconciliation applied — number of catalog entries read",
        outputSchema
      ),
      "401": errorResponse("Unauthorized"),
      "403": errorResponse("Forbidden — admin role required"),
    },
  };

  constructor(
    private readonly useCase: ReconcilePlanCatalogFromGatewayUseCase
  ) {}

  async handle() {
    return this.useCase.execute();
  }
}
