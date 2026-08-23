import type { StayCanceledEvent } from "../../../booking/domain/event/stay_canceled_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import { LedgerEntry } from "../../domain/entity/ledger_entry";
import type { LedgerEntryRepository } from "../../domain/repository/ledger_entry_repository";
import { describeStayCancellation } from "../content/stay_ledger_description";
import type { StayLedgerPreferences } from "../service/stay_ledger_preferences";

export class RevertRevenueOnStayCancel
  implements EventHandler<StayCanceledEvent>
{
  constructor(
    private readonly logger: Logger,
    private readonly ledgerEntryRepository: LedgerEntryRepository,
    private readonly stayLedgerPreferences: StayLedgerPreferences
  ) {}

  async handle(event: StayCanceledEvent): Promise<void> {
    this.logger.info("Stay canceled - reverting revenue", {
      event: event,
      stayId: event.stay_id,
    });

    const preferences = await this.stayLedgerPreferences.ofProperty(
      event.property_id
    );

    const ledgerEntry = LedgerEntry.newExpense({
      amount: event.price * -1,
      description: describeStayCancellation(event, preferences),
      category: "ESTADIA",
      property_id: event.property_id,
    });
    await this.ledgerEntryRepository.save(ledgerEntry);
  }
}
