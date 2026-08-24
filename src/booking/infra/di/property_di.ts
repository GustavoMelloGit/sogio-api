import type { CalendarAdapter } from "../../application/adapter/calendar_adapter";
import type { ExternalBookingSourcesRepository } from "../../domain/repository/external_booking_source_repository";
import { BookStayUseCase } from "../../application/use_case/property/book_stay";
import { CreateExternalBookingSourceUseCase } from "../../application/use_case/property/create_external_booking_source";
import { ReconcileExternalBookingsUseCase } from "../../application/use_case/property/reconcile_external_bookings";
import { ImportBatchStaysUseCase } from "../../application/use_case/import_batch_stays";
import type { BookingPolicy } from "../../domain/policy/booking_policy";
import type { StayRepository } from "../../domain/repository/stay_repository";
import type { TenantRepository } from "../../domain/repository/tenant_repository";
import { BookStayController } from "../../presentation/controller/property/book_stay.controller";
import { CreateExternalBookingSourceController } from "../../presentation/controller/property/create_external_booking.controller";
import { ReconcileExternalBookingController } from "../../presentation/controller/property/reconcile_external_booking.controller";
import { ImportStaysController } from "../../presentation/controller/import_stays.controller";
import { makeBookStayTool } from "../../presentation/mcp_tool/book_stay.mcp_tool";
import { makeImportStaysTool } from "../../presentation/mcp_tool/import_stays.mcp_tool";
import { makeCreateExternalBookingSourceTool } from "../../presentation/mcp_tool/create_external_booking_source.mcp_tool";
import { makeReconcileExternalBookingsTool } from "../../presentation/mcp_tool/reconcile_external_bookings.mcp_tool";
import { ICalendarAdapter } from "../adapter/i_calendar_adapter";
import { PostgresBookingPolicy } from "../database/postgres_policies/postgres_booking_policy";
import { ExternalBookingSourcePostgresRepository } from "../database/postgres_repository/external_booking_source_postgres_repository";
import { StayPostgresRepository } from "../database/postgres_repository/stay_postgres_repository";
import { TenantPostgresRepository } from "../database/postgres_repository/tenant_postgres_repository";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import { inMemoryEventDispatcher } from "../../../core/infra/event/in_memory_event_dispatcher";
import type { Logger } from "../../../core/application/logger/logger";
import { ConsoleLogger } from "../../../core/infra/logger/console_logger";
import { BookingPropertyPostgresRepository } from "../database/postgres_repository/booking_property_repository";
import type { BookingPropertyRepository } from "../../domain/repository/booking_property_repository";
import type { EntranceCodeGenerator } from "../../domain/service/entrance_code_generator";
import { CryptoEntranceCodeGenerator } from "../service/crypto_entrance_code_generator";
import type { TransactionRunner } from "../../../core/application/transaction/transaction_runner";
import { DrizzleTransactionRunner } from "../../../core/infra/database/drizzle/drizzle_transaction_runner";
import { ImportRunner } from "../../../core/application/import/import_runner";
import type { PropertyCheckTimesService } from "../../../property_management/application/service/property_check_times_service";
import { SettingPropertyCheckTimesService } from "../../../property_management/application/service/setting_property_check_times_service";
import { PropertySettingPostgresRepository } from "../../../property_management/infra/database/postgres_repository/property_setting_postgres_repository";

export class PropertyDi {
  #tenantRepository: TenantRepository;
  #propertyRepository: BookingPropertyRepository;
  #bookingPolicy: BookingPolicy;
  #stayRepository: StayRepository;
  #externalBookingSourceRepository: ExternalBookingSourcesRepository;
  #calendarAdapter: CalendarAdapter;
  #eventDispatcher: EventDispatcher;
  #logger: Logger;
  #entranceCodeGenerator: EntranceCodeGenerator;
  #transactionRunner: TransactionRunner;
  #importRunner: ImportRunner;
  #propertyCheckTimesService: PropertyCheckTimesService;

  constructor() {
    this.#logger = new ConsoleLogger();
    this.#tenantRepository = new TenantPostgresRepository();
    this.#propertyRepository = new BookingPropertyPostgresRepository();
    this.#bookingPolicy = new PostgresBookingPolicy();
    this.#stayRepository = new StayPostgresRepository();
    this.#externalBookingSourceRepository =
      new ExternalBookingSourcePostgresRepository();
    this.#calendarAdapter = new ICalendarAdapter();
    this.#eventDispatcher = inMemoryEventDispatcher;
    this.#entranceCodeGenerator = new CryptoEntranceCodeGenerator();
    this.#transactionRunner = new DrizzleTransactionRunner();
    this.#importRunner = new ImportRunner(this.#transactionRunner);
    this.#propertyCheckTimesService = new SettingPropertyCheckTimesService(
      new PropertySettingPostgresRepository(),
      this.#logger
    );
  }

  // Use Cases
  makeBookStayUseCase() {
    return new BookStayUseCase(
      this.#tenantRepository,
      this.#propertyRepository,
      this.#stayRepository,
      this.#bookingPolicy,
      this.#eventDispatcher,
      this.#entranceCodeGenerator
    );
  }
  makeImportBatchStaysUseCase() {
    return new ImportBatchStaysUseCase(
      this.#tenantRepository,
      this.#propertyRepository,
      this.#stayRepository,
      this.#bookingPolicy,
      this.#eventDispatcher,
      this.#entranceCodeGenerator,
      this.#importRunner,
      this.#propertyCheckTimesService
    );
  }
  makeReconcileExternalBookingUseCase() {
    return new ReconcileExternalBookingsUseCase(
      this.#externalBookingSourceRepository,
      this.#stayRepository,
      this.#calendarAdapter,
      this.#propertyRepository,
      this.#logger
    );
  }
  makeCreateExternalBookingSourceUseCase() {
    return new CreateExternalBookingSourceUseCase(
      this.#externalBookingSourceRepository,
      this.#propertyRepository
    );
  }

  // Controllers
  makeBookStayController() {
    return new BookStayController(this.makeBookStayUseCase());
  }
  makeImportStaysController() {
    return new ImportStaysController(this.makeImportBatchStaysUseCase());
  }
  makeReconcileExternalBookingController() {
    return new ReconcileExternalBookingController(
      this.makeReconcileExternalBookingUseCase()
    );
  }
  makeCreateExternalBookingSourceController() {
    return new CreateExternalBookingSourceController(
      this.makeCreateExternalBookingSourceUseCase()
    );
  }

  // MCP Tools
  makeBookStayTool() {
    return makeBookStayTool(this.makeBookStayUseCase());
  }
  makeCreateExternalBookingSourceTool() {
    return makeCreateExternalBookingSourceTool(
      this.makeCreateExternalBookingSourceUseCase()
    );
  }
  makeImportStaysTool() {
    return makeImportStaysTool(this.makeImportBatchStaysUseCase());
  }
  makeReconcileExternalBookingsTool() {
    return makeReconcileExternalBookingsTool(
      this.makeReconcileExternalBookingUseCase()
    );
  }
}
