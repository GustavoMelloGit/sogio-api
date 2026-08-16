import type { PropertyRepository } from "../../domain/repository/property_repository";
import type { PropertySettingRepository } from "../../domain/repository/property_setting_repository";
import type { EntitlementService } from "../../../billing/application/service/entitlement_service";
import { UpdatePropertyUseCase } from "../../application/use_case/update_property";
import { UpdatePropertyController } from "../../presentation/controller/update_property.controller";
import { PropertyPostgresRepository } from "../database/postgres_repository/property_postgres_repository";
import { PropertySettingPostgresRepository } from "../database/postgres_repository/property_setting_postgres_repository";
import { FindUserPropertiesUseCase } from "../../application/use_case/find_user_properties";
import { FindUserPropertiesController } from "../../presentation/controller/find_user_properties.controller";
import { FindPropertyUseCase } from "../../application/use_case/find_property";
import { FindPropertyController } from "../../presentation/controller/find_property.controller";
import { CreatePropertyUseCase } from "../../application/use_case/create_property";
import { CreatePropertyController } from "../../presentation/controller/create_property.controller";
import { CreatePropertySettingUseCase } from "../../application/use_case/create_property_setting";
import { CreatePropertySettingController } from "../../presentation/controller/create_property_setting.controller";
import { GetPropertySettingUseCase } from "../../application/use_case/get_property_setting";
import { GetPropertySettingController } from "../../presentation/controller/get_property_setting.controller";
import { ListPropertySettingsUseCase } from "../../application/use_case/list_property_settings";
import { ListPropertySettingsController } from "../../presentation/controller/list_property_settings.controller";
import { UpdatePropertySettingUseCase } from "../../application/use_case/update_property_setting";
import { UpdatePropertySettingController } from "../../presentation/controller/update_property_setting.controller";
import { DeletePropertySettingUseCase } from "../../application/use_case/delete_property_setting";
import { DeletePropertySettingController } from "../../presentation/controller/delete_property_setting.controller";
import { DeletePropertyUseCase } from "../../application/use_case/delete_property";
import { DeletePropertyController } from "../../presentation/controller/delete_property.controller";
import type { PropertyOccupancy } from "../../domain/service/property_occupancy";

export class PropertyManagementDi {
  #propertyRepository: PropertyRepository;
  #propertySettingRepository: PropertySettingRepository;
  #entitlementService: EntitlementService;
  #propertyOccupancy: PropertyOccupancy;

  constructor(
    entitlementService: EntitlementService,
    propertyOccupancy: PropertyOccupancy
  ) {
    this.#propertyRepository = new PropertyPostgresRepository();
    this.#propertySettingRepository = new PropertySettingPostgresRepository();
    this.#entitlementService = entitlementService;
    this.#propertyOccupancy = propertyOccupancy;
  }

  // Use Cases
  makeCreatePropertyUseCase() {
    return new CreatePropertyUseCase(
      this.#propertyRepository,
      this.#entitlementService
    );
  }
  makeUpdatePropertyUseCase() {
    return new UpdatePropertyUseCase(this.#propertyRepository);
  }
  makeFindUserPropertiesUseCase() {
    return new FindUserPropertiesUseCase(this.#propertyRepository);
  }
  makeFindPropertyUseCase() {
    return new FindPropertyUseCase(this.#propertyRepository);
  }
  makeCreatePropertySettingUseCase() {
    return new CreatePropertySettingUseCase(
      this.#propertyRepository,
      this.#propertySettingRepository
    );
  }
  makeGetPropertySettingUseCase() {
    return new GetPropertySettingUseCase(
      this.#propertyRepository,
      this.#propertySettingRepository
    );
  }
  makeListPropertySettingsUseCase() {
    return new ListPropertySettingsUseCase(
      this.#propertyRepository,
      this.#propertySettingRepository
    );
  }
  makeUpdatePropertySettingUseCase() {
    return new UpdatePropertySettingUseCase(
      this.#propertyRepository,
      this.#propertySettingRepository
    );
  }
  makeDeletePropertySettingUseCase() {
    return new DeletePropertySettingUseCase(
      this.#propertyRepository,
      this.#propertySettingRepository
    );
  }
  makeDeletePropertyUseCase() {
    return new DeletePropertyUseCase(
      this.#propertyRepository,
      this.#propertyOccupancy
    );
  }

  // Controllers
  makeCreatePropertyController() {
    return new CreatePropertyController(this.makeCreatePropertyUseCase());
  }
  makeUpdatePropertyController() {
    return new UpdatePropertyController(this.makeUpdatePropertyUseCase());
  }
  makeFindUserPropertiesController() {
    return new FindUserPropertiesController(
      this.makeFindUserPropertiesUseCase()
    );
  }
  makeFindPropertyController() {
    return new FindPropertyController(this.makeFindPropertyUseCase());
  }
  makeCreatePropertySettingController() {
    return new CreatePropertySettingController(
      this.makeCreatePropertySettingUseCase()
    );
  }
  makeGetPropertySettingController() {
    return new GetPropertySettingController(
      this.makeGetPropertySettingUseCase()
    );
  }
  makeListPropertySettingsController() {
    return new ListPropertySettingsController(
      this.makeListPropertySettingsUseCase()
    );
  }
  makeUpdatePropertySettingController() {
    return new UpdatePropertySettingController(
      this.makeUpdatePropertySettingUseCase()
    );
  }
  makeDeletePropertySettingController() {
    return new DeletePropertySettingController(
      this.makeDeletePropertySettingUseCase()
    );
  }
  makeDeletePropertyController() {
    return new DeletePropertyController(this.makeDeletePropertyUseCase());
  }
}
