import type { CalendarAdapter } from "../../application/adapter/calendar_adapter";
import type { ExternalBookingSourcesRepository } from "../../domain/repository/external_booking_source_repository";
import { BookStayUseCase } from "../../application/use_case/property/book_stay";
import { CreateExternalBookingSourceUseCase } from "../../application/use_case/property/create_external_booking_source";
import { ReconcileExternalBookingsUseCase } from "../../application/use_case/property/reconcile_external_bookings";
import type { BookingPolicy } from "../../domain/policy/booking_policy";
import type { StayRepository } from "../../domain/repository/stay_repository";
import type { TenantRepository } from "../../domain/repository/tenant_repository";
import { BookStayController } from "../../presentation/controller/property/book_stay.controller";
import { CreateExternalBookingSourceController } from "../../presentation/controller/property/create_external_booking.controller";
import { ReconcileExternalBookingController } from "../../presentation/controller/property/reconcile_external_booking.controller";
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
}
