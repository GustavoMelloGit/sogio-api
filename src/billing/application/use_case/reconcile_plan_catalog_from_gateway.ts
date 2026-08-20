import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";
import type { PaymentGateway } from "../gateway/payment_gateway";
import type { SyncPlanCatalogEntryUseCase } from "./sync_plan_catalog_entry";

type Input = Record<string, never>;
type Output = void;

/**
 * Reads the gateway's entire price catalog and applies every entry through
 * the same writer the webhook uses (DA-5) — the only mechanism that
 * populates `plans` from nothing (bootstrap) or repairs it after missed
 * webhooks. Two triggers call this: application boot (non-fatal, skipped
 * in `test`/without a Stripe key) and `POST /billing/catalog/sync`
 * (`adminOnly`, `allowWithoutPlatformAccess` — the paywall's own exit can't
 * sit behind the paywall).
 *
 * A single `now` is stamped as `external_event_at` for every entry in this
 * pass (DA-7): the gateway's current truth is by definition the freshest
 * information available, so `SyncPlanCatalogEntryUseCase.applyReconciledEntry`
 * skips its own staleness check rather than risk two concurrent boots (a
 * cold start racing a fresh deploy) rejecting each other's writes.
 *
 * Never throws a business error itself — the writer already never does
 * (DA-4), and one malformed/colliding entry never stops the rest of the
 * pass. A genuine infrastructure failure (gateway or database down) still
 * propagates, which is what makes the caller's own handling (boot: log and
 * continue; route: surface a 500) meaningful.
 */
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
  }
}
