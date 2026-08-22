import type { DisplayPreferencesService } from "../../../auth/application/service/display_preferences_service";
import type { StayBookedEvent } from "../../../booking/domain/event/stay_booked_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";
import { LedgerEntry } from "../../domain/entity/ledger_entry";
import type { LedgerEntryRepository } from "../../domain/repository/ledger_entry_repository";
import { describeStayRevenue } from "./stay_ledger_description";
import { stayLedgerPreferences } from "./stay_ledger_preferences";

export class RecordRevenueOnStayPaymentConfirmed
  implements EventHandler<StayBookedEvent>
{
  constructor(
    private readonly logger: Logger,
    private readonly ledgerEntryRepository: LedgerEntryRepository,
    private readonly propertyRepository: PropertyRepository,
    private readonly displayPreferencesService: DisplayPreferencesService
  ) {}

  async handle(event: StayBookedEvent): Promise<void> {
    this.logger.info("Stay payment confirmed - recording revenue", {
      event: event,
      stayId: event.stay_id,
      amount: event.paid_amount,
    });

    const preferences = await stayLedgerPreferences(
      event.property_id,
      this.propertyRepository,
      this.displayPreferencesService
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
