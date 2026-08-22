import { StayBookedEvent } from "../../../booking/domain/event/stay_booked_event";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { Logger } from "../../../core/application/logger/logger";
import { inMemoryEventDispatcher } from "../../../core/infra/event/in_memory_event_dispatcher";
import { ConsoleLogger } from "../../../core/infra/logger/console_logger";
import { RecordRevenueOnStayPaymentConfirmed } from "../../application/handler/record_revenue_on_stay_payment_confirmed";
import { RecordExpenseUseCase } from "../../application/use_case/record_expense";
import { RecordRevenueUseCase } from "../../application/use_case/record_revenue";
import { FindPropertyFinancialMovementsUseCase } from "../../application/use_case/find_property_financial_movements";
import type { LedgerEntryRepository } from "../../domain/repository/ledger_entry_repository";
import { RecordExpenseController } from "../../presentation/controller/record_expense.controller";
import { RecordRevenueController } from "../../presentation/controller/record_revenue.controller";
import { FindPropertyFinancialMovementsController } from "../../presentation/controller/find_property_financial_movements.controller";
import { makeRecordExpenseTool } from "../../presentation/mcp_tool/record_expense.mcp_tool";
import { LedgerEntryPostgresRepository } from "../database/postgres_repository/ledger_entry_postgres_repository";
import { RevertRevenueOnStayCancel } from "../../application/handler/revert_revenue_on_stay_cancel";
import { StayCanceledEvent } from "../../../booking/domain/event/stay_canceled_event";
import { RecordRevenueOnStayImported } from "../../application/handler/record_revenue_on_stay_imported";
import { StayImportedEvent } from "../../../booking/domain/event/stay_imported_event";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";
import { PropertyPostgresRepository } from "../../../property_management/infra/database/postgres_repository/property_postgres_repository";

export class FinanceDi {
  #logger: Logger;
  #eventDispatcher: EventDispatcher;
  #ledgerEntryRepository: LedgerEntryRepository;
  #propertyRepository: PropertyRepository;

  constructor() {
    this.#logger = new ConsoleLogger();
    this.#eventDispatcher = inMemoryEventDispatcher;
    this.#ledgerEntryRepository = new LedgerEntryPostgresRepository();
    this.#propertyRepository = new PropertyPostgresRepository();
  }

  registerEventHandlers(): void {
    this.#eventDispatcher.register(
      StayBookedEvent.NAME,
      this.makeRecordRevenueOnStayPaymentConfirmedHandler()
    );
    this.#eventDispatcher.register(
      StayCanceledEvent.NAME,
      this.makeRevertRevenueOnStayCancelHandler()
    );
    this.#eventDispatcher.register(
      StayImportedEvent.NAME,
      this.makeRecordRevenueOnStayImportedHandler()
    );
  }

  // Handlers
  makeRecordRevenueOnStayPaymentConfirmedHandler() {
    return new RecordRevenueOnStayPaymentConfirmed(
      this.#logger,
      this.#ledgerEntryRepository
    );
  }
  makeRevertRevenueOnStayCancelHandler() {
    return new RevertRevenueOnStayCancel(
      this.#logger,
      this.#ledgerEntryRepository
    );
  }
  makeRecordRevenueOnStayImportedHandler() {
    return new RecordRevenueOnStayImported(
      this.#logger,
      this.#ledgerEntryRepository
    );
  }

  // Use Cases
  makeRecordExpenseUseCase() {
    return new RecordExpenseUseCase(
      this.#ledgerEntryRepository,
      this.#propertyRepository
    );
  }

  makeRecordRevenueUseCase() {
    return new RecordRevenueUseCase(
      this.#ledgerEntryRepository,
      this.#propertyRepository
    );
  }

  makeFindPropertyFinancialMovementsUseCase() {
    return new FindPropertyFinancialMovementsUseCase(
      this.#ledgerEntryRepository,
      this.#propertyRepository
    );
  }

  // Controllers
  makeRecordExpenseController() {
    return new RecordExpenseController(this.makeRecordExpenseUseCase());
  }

  makeRecordRevenueController() {
    return new RecordRevenueController(this.makeRecordRevenueUseCase());
  }

  makeFindPropertyFinancialMovementsController() {
    return new FindPropertyFinancialMovementsController(
      this.makeFindPropertyFinancialMovementsUseCase()
    );
  }

  // MCP Tools
  makeRecordExpenseTool() {
    return makeRecordExpenseTool(this.makeRecordExpenseUseCase());
  }
}
