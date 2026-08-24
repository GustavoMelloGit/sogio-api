import { GetPublicStayUseCase } from "../../application/use_case/stay/get_public_stay";
import { StayPropertyOccupancy } from "../../application/service/stay_property_occupancy";
import { CancelStayService } from "../../application/service/cancel_stay_service";
import type { PropertyOccupancy } from "../../../property_management/domain/service/property_occupancy";
import { GetStayUseCase } from "../../application/use_case/stay/get_stay";
import { FindPropertyStaysUseCase } from "../../application/use_case/stay/find_property_stays";
import { CancelStayUseCase } from "../../application/use_case/stay/cancel_stay";
import { UpdateStayUseCase } from "../../application/use_case/stay/update_stay";
import { GetDashboardOverviewUseCase } from "../../application/use_case/dashboard/get_dashboard_overview";
import type { StayRepository } from "../../domain/repository/stay_repository";
import { GetPublicStayController } from "../../presentation/controller/stay/get_public_stay.controller";
import { GetStayController } from "../../presentation/controller/stay/get_stay.controller";
import { FindPropertyStaysController } from "../../presentation/controller/stay/find_property_stays.controller";
import { CancelStayController } from "../../presentation/controller/stay/cancel_stay.controller";
import { UpdateStayController } from "../../presentation/controller/stay/update_stay.controller";
import { GetDashboardOverviewController } from "../../presentation/controller/dashboard/get_dashboard_overview.controller";
import { makeCancelStayTool } from "../../presentation/mcp_tool/cancel_stay.mcp_tool";
import { makeListStaysTool } from "../../presentation/mcp_tool/list_stays.mcp_tool";
import { makeGetDashboardOverviewTool } from "../../presentation/mcp_tool/get_dashboard_overview.mcp_tool";
import { makeGetStayTool } from "../../presentation/mcp_tool/get_stay.mcp_tool";
import { makeUpdateStayTool } from "../../presentation/mcp_tool/update_stay.mcp_tool";
import { StayPostgresRepository } from "../database/postgres_repository/stay_postgres_repository";
import type { TenantRepository } from "../../domain/repository/tenant_repository";
import { TenantPostgresRepository } from "../database/postgres_repository/tenant_postgres_repository";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";
import { PropertyPostgresRepository } from "../../../property_management/infra/database/postgres_repository/property_postgres_repository";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import { inMemoryEventDispatcher } from "../../../core/infra/event/in_memory_event_dispatcher";
import type { BookingPolicy } from "../../domain/policy/booking_policy";
import { PostgresBookingPolicy } from "../database/postgres_policies/postgres_booking_policy";
import { StayBookedEvent } from "../../domain/event/stay_booked_event";
import { CreateTempPasswordOnBook } from "../../application/handler/create_temp_password_on_book";
import type { Logger } from "../../../core/application/logger/logger";
import { ConsoleLogger } from "../../../core/infra/logger/console_logger";
import type { DeviceManagementService } from "../../domain/service/device_management";
import { TuyaDeviceManagementService } from "../service/tuya_device_management";
import { tuyaContext } from "../../../core/infra/config/tuya";
import { LedgerEntryPostgresRepository } from "../../../finance/infra/database/postgres_repository/ledger_entry_postgres_repository";
import type { LedgerEntryRepository } from "../../../finance/domain/repository/ledger_entry_repository";

export class StayDi {
  #logger: Logger;
  #propertyRepository: PropertyRepository;
  #stayRepository: StayRepository;
  #tenantRepository: TenantRepository;
  #eventDispatcher: EventDispatcher;
  #bookingPolicy: BookingPolicy;
  #deviceManagementService: DeviceManagementService;
  #ledgerEntryRepository: LedgerEntryRepository;

  constructor() {
    this.#logger = new ConsoleLogger();
    this.#propertyRepository = new PropertyPostgresRepository();
    this.#stayRepository = new StayPostgresRepository();
    this.#tenantRepository = new TenantPostgresRepository();
    this.#bookingPolicy = new PostgresBookingPolicy();
    this.#ledgerEntryRepository = new LedgerEntryPostgresRepository();
    this.#deviceManagementService = new TuyaDeviceManagementService(
      tuyaContext,
      this.#logger
    );
    this.#eventDispatcher = inMemoryEventDispatcher;
  }

  registerEventHandlers(): void {
    this.#eventDispatcher.register(
      StayBookedEvent.NAME,
      this.makeCreateTempPasswordOnBookHandler()
    );
  }

  // Use Cases
  makeGetStayUseCase() {
    return new GetStayUseCase(
      this.#propertyRepository,
      this.#stayRepository,
      this.#tenantRepository
    );
  }
  makeGetPublicStayUseCase() {
    return new GetPublicStayUseCase(
      this.#stayRepository,
      this.#tenantRepository
    );
  }
  makeFindPropertyStaysUseCase() {
    return new FindPropertyStaysUseCase(
      this.#propertyRepository,
      this.#stayRepository
    );
  }
  makeCancelStayUseCase() {
    return new CancelStayUseCase(
      this.#stayRepository,
      this.#propertyRepository,
      this.makeCancelStayService()
    );
  }
  makeUpdateStayUseCase() {
    return new UpdateStayUseCase(
      this.#propertyRepository,
      this.#stayRepository,
      this.#bookingPolicy
    );
  }
  makeGetDashboardOverviewUseCase() {
    return new GetDashboardOverviewUseCase(
      this.#propertyRepository,
      this.#stayRepository,
      this.#ledgerEntryRepository
    );
  }

  // Services
  makeCancelStayService(): CancelStayService {
    return new CancelStayService(this.#stayRepository, this.#eventDispatcher);
  }
  /** Consumed by `PropertyManagementDi` in the composition root (DA-3). */
  makeStayPropertyOccupancy(): PropertyOccupancy {
    return new StayPropertyOccupancy(
      this.#stayRepository,
      this.makeCancelStayService()
    );
  }

  // Controllers
  makeGetStayController() {
    return new GetStayController(this.makeGetStayUseCase());
  }
  makeGetPublicStayController() {
    return new GetPublicStayController(this.makeGetPublicStayUseCase());
  }
  makeFindPropertyStaysController() {
    return new FindPropertyStaysController(this.makeFindPropertyStaysUseCase());
  }
  makeCancelStayController() {
    return new CancelStayController(this.makeCancelStayUseCase());
  }
  makeUpdateStayController() {
    return new UpdateStayController(this.makeUpdateStayUseCase());
  }
  makeGetDashboardOverviewController() {
    return new GetDashboardOverviewController(
      this.makeGetDashboardOverviewUseCase()
    );
  }

  // Handlers
  makeCreateTempPasswordOnBookHandler() {
    return new CreateTempPasswordOnBook(
      this.#logger,
      this.#deviceManagementService
    );
  }

  // MCP Tools
  makeCancelStayTool() {
    return makeCancelStayTool(this.makeCancelStayUseCase());
  }
  makeListStaysTool() {
    return makeListStaysTool(this.makeFindPropertyStaysUseCase());
  }
  makeGetDashboardOverviewTool() {
    return makeGetDashboardOverviewTool(this.makeGetDashboardOverviewUseCase());
  }
  makeGetStayTool() {
    return makeGetStayTool(this.makeGetStayUseCase());
  }
  makeUpdateStayTool() {
    return makeUpdateStayTool(this.makeUpdateStayUseCase());
  }
}
