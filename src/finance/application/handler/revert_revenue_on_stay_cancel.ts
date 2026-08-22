import type { DisplayPreferencesService } from "../../../auth/application/service/display_preferences_service";
import type { StayCanceledEvent } from "../../../booking/domain/event/stay_canceled_event";
import type { EventHandler } from "../../../core/application/event/event_handler";
import type { Logger } from "../../../core/application/logger/logger";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";
import { LedgerEntry } from "../../domain/entity/ledger_entry";
import type { LedgerEntryRepository } from "../../domain/repository/ledger_entry_repository";
import { describeStayCancellation } from "./stay_ledger_description";
import { stayLedgerPreferences } from "./stay_ledger_preferences";

export class RevertRevenueOnStayCancel
  implements EventHandler<StayCanceledEvent>
{
  constructor(
    private readonly logger: Logger,
    private readonly ledgerEntryRepository: LedgerEntryRepository,
    private readonly propertyRepository: PropertyRepository,
    private readonly displayPreferencesService: DisplayPreferencesService
  ) {}

  async handle(event: StayCanceledEvent): Promise<void> {
    this.logger.info("Stay canceled - reverting revenue", {
      event: event,
      stayId: event.stay_id,
    });

    const preferences = await stayLedgerPreferences(
      event.property_id,
      this.propertyRepository,
      this.displayPreferencesService
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
