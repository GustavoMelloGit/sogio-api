import type { StayBookedEvent } from "../../../booking/domain/event/stay_booked_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import { LedgerEntry } from "../../domain/entity/ledger_entry";
import type { LedgerEntryRepository } from "../../domain/repository/ledger_entry_repository";
import { describeStayRevenue } from "../content/stay_ledger_description";
import type { StayLedgerPreferences } from "../service/stay_ledger_preferences";

export class RecordRevenueOnStayPaymentConfirmed
  implements EventHandler<StayBookedEvent>
{
  constructor(
    private readonly logger: Logger,
    private readonly ledgerEntryRepository: LedgerEntryRepository,
    private readonly stayLedgerPreferences: StayLedgerPreferences
  ) {}

  async handle(event: StayBookedEvent): Promise<void> {
    this.logger.info("Stay payment confirmed - recording revenue", {
      event: event,
      stayId: event.stay_id,
      amount: event.paid_amount,
    });

    const preferences = await this.stayLedgerPreferences.ofProperty(
      event.property_id
    );

    const ledgerEntry = LedgerEntry.newRevenue({
      amount: event.paid_amount,
      description: describeStayRevenue(event, preferences),
      category: "ESTADIA",
      property_id: event.property_id,
    });

    await this.ledgerEntryRepository.save(ledgerEntry);
  }
}
