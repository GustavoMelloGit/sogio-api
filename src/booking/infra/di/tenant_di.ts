import { ListTenantsUseCase } from "../../application/use_case/tenant/list_tenents";
import type { TenantRepository } from "../../domain/repository/tenant_repository";
import { ListTenantsController } from "../../presentation/controller/tenant/list_tenants.controller";
import { TenantPostgresRepository } from "../database/postgres_repository/tenant_postgres_repository";
import { makeListTenantsTool } from "../../presentation/mcp_tool/list_tenants.mcp_tool";

export class TenantDi {
  #tenantRepository: TenantRepository;
  constructor() {
    this.#tenantRepository = new TenantPostgresRepository();
  }

  // Use Cases
  makeListTenantsUseCase() {
    return new ListTenantsUseCase(this.#tenantRepository);
  }

  // Controllers
  makeListTenantsController() {
    return new ListTenantsController(this.makeListTenantsUseCase());
  }

  // MCP Tools
  makeListTenantsTool() {
    return makeListTenantsTool(this.makeListTenantsUseCase());
  }
}
