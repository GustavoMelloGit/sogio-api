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

export class SyncPlanCatalogController implements Controller {
  path = "/billing/catalog/sync";
  method = HttpControllerMethod.POST;

  openApiSpec: OpenApiOperation = {
    summary: "Reconcile the plan catalog from the payment gateway",
    description:
      "Reads the entire price catalog from the gateway and applies it to the local plans table. Admin only.",
    tags: ["Billing"],
    responses: {
      "200": responseFromZod(
        "Reconciliation applied — number of catalog entries read",
        outputSchema,
        { entries_seen: 2 }
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
