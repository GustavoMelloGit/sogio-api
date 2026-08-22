import type { StayBookedEvent } from "../../../booking/domain/event/stay_booked_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import { LedgerEntry } from "../../domain/entity/ledger_entry";
import type { LedgerEntryRepository } from "../../domain/repository/ledger_entry_repository";
import { describeStayRevenue } from "./stay_ledger_description";

export class RecordRevenueOnStayPaymentConfirmed
  implements EventHandler<StayBookedEvent>
{
  constructor(
    private readonly logger: Logger,
    private readonly ledgerEntryRepository: LedgerEntryRepository
  ) {}

  async handle(event: StayBookedEvent): Promise<void> {
    this.logger.info("Stay payment confirmed - recording revenue", {
      event: event,
      stayId: event.stay_id,
      amount: event.paid_amount,
    });

    const ledgerEntry = LedgerEntry.newRevenue({
      amount: event.paid_amount,
      description: describeStayRevenue(event),
      category: "ESTADIA",
      property_id: event.property_id,
    });

    await this.ledgerEntryRepository.save(ledgerEntry);
  }
}
