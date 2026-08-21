import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import type { PaymentGateway } from "../gateway/payment_gateway";
import type { SyncPlanCatalogEntryUseCase } from "./sync_plan_catalog_entry";

type Input = Record<string, never>;
type Output = { entries_seen: number };

export class ReconcilePlanCatalogFromGatewayUseCase
  implements UseCase<Input, Output>
{
  constructor(
    private readonly paymentGateway: PaymentGateway,
    private readonly syncPlanCatalogEntryUseCase: SyncPlanCatalogEntryUseCase,
    private readonly logger: Logger
  ) {}

  async execute(): Promise<Output> {
    const entries = await this.paymentGateway.listCatalogEntries();
    const now = new Date();

    for (const entry of entries) {
      await this.syncPlanCatalogEntryUseCase.applyReconciledEntry(entry, now);
    }

    this.logger.info("Reconciled the plan catalog from the gateway", {
      entries_seen: entries.length,
    });

    return { entries_seen: entries.length };
  }
}
