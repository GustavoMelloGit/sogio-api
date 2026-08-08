import {
  HttpControllerMethod,
  type Controller,
} from "../../../presentation/controller/controller";
import { HealthController } from "../../../presentation/controller/health/health.controller";
import { CorsMiddleware } from "../../../presentation/middleware/cors.middleware";
import { AuthDi } from "../../../../auth/infra/di/auth_di";
import { PropertyDi } from "../../../../booking/infra/di/property_di";
import { StayDi } from "../../../../booking/infra/di/stay_di";
import { TenantDi } from "../../../../booking/infra/di/tenant_di";
import { BunHttpControllerAdapter } from "../adapters/http_controller_adapter";
import { FinanceDi } from "../../../../finance/infra/di/finance_di";
import { PropertyManagementDi } from "../../../../property_management/infra/di/property_management_di";
import { BackofficeDi } from "../../../../backoffice/infra/di/backoffice_di";
import { OpenApiBuilder } from "../swagger/open_api_builder";
import { swaggerUiHtml } from "../swagger/swagger_ui";
import { makeMcpRequestHandler } from "../../mcp/routes";

const tenantDi = new TenantDi();
const propertyDi = new PropertyDi();
const authDi = new AuthDi();
const stayDi = new StayDi();
const corsMiddleware = new CorsMiddleware();
const financeDi = new FinanceDi();
const propertyManagementDi = new PropertyManagementDi();
const backofficeDi = new BackofficeDi();

type Route = {
  controller: Controller;
  authenticated: boolean;
  adminOnly?: boolean;
};

const healthController: Route = {
  authenticated: false,
  controller: new HealthController(),
};

const tenantControllers: Route[] = [
  {
    authenticated: true,
    controller: tenantDi.makeListTenantsController(),
  },
];

const propertyControllers: Route[] = [
  {
    authenticated: true,
    controller: propertyDi.makeBookStayController(),
  },
  {
    authenticated: true,
    controller: propertyDi.makeReconcileExternalBookingController(),
  },
  {
    authenticated: true,
    controller: propertyDi.makeCreateExternalBookingSourceController(),
  },
];

const financeControllers: Route[] = [
  {
    authenticated: true,
    controller: financeDi.makeRecordExpenseController(),
  },
  {
    authenticated: true,
    controller: financeDi.makeRecordRevenueController(),
  },
  {
    authenticated: true,
    controller: financeDi.makeFindPropertyFinancialMovementsController(),
  },
];

const propertyManagementControllers: Route[] = [
  {
    authenticated: true,
    controller: propertyManagementDi.makeCreatePropertyController(),
  },
  {
    authenticated: true,
    controller: propertyManagementDi.makeUpdatePropertyController(),
  },
  {
    authenticated: true,
    controller: propertyManagementDi.makeFindUserPropertiesController(),
  },
  {
    authenticated: true,
    controller: propertyManagementDi.makeFindPropertyController(),
  },
];

const stayControllers: Route[] = [
  {
    authenticated: true,
    controller: stayDi.makeGetStayController(),
  },
  {
    authenticated: false,
    controller: stayDi.makeGetPublicStayController(),
  },
  {
    authenticated: true,
    controller: stayDi.makeFindPropertyStaysController(),
  },
  {
    authenticated: true,
    controller: stayDi.makeCancelStayController(),
  },
  {
    authenticated: true,
    controller: stayDi.makeUpdateStayController(),
  },
  {
    authenticated: true,
    controller: stayDi.makeGetDashboardOverviewController(),
  },
];

const authControllers: Route[] = [
  {
    authenticated: false,
    controller: authDi.makeRegisterUserController(),
  },
  {
    authenticated: false,
    controller: authDi.makeSignInController(),
  },
  {
    authenticated: true,
    controller: authDi.makeGetUserController(),
  },
  {
    authenticated: true,
    controller: authDi.makePurgeUserDataController(),
  },
];

const discoveryControllers: Route[] = [
  {
    authenticated: false,
    controller: authDi.makeOAuthProtectedResourceMetadataController(),
  },
  {
    authenticated: false,
    controller: authDi.makeOAuthProtectedResourceMetadataForMcpController(),
  },
  {
    authenticated: false,
    controller: authDi.makeOAuthAuthorizationServerMetadataController(),
  },
];

const delegatedAccessControllers: Route[] = [
  {
    authenticated: false,
    controller: authDi.makeRegisterAppController(),
  },
  {
    authenticated: false,
    controller: authDi.makeAuthorizeController(),
  },
  {
    authenticated: false,
    controller: authDi.makeGetPendingAuthorizationRequestController(),
  },
  {
    authenticated: true,
    controller: authDi.makeDecideAuthorizationRequestController(),
  },
];

const backofficeControllers: Route[] = [
  {
    authenticated: true,
    adminOnly: true,
    controller: backofficeDi.makeCreateAppSettingController(),
  },
  {
    authenticated: true,
    controller: backofficeDi.makeListAppSettingsController(),
  },
  {
    authenticated: true,
    controller: backofficeDi.makeGetAppSettingController(),
  },
  {
    authenticated: true,
    controller: backofficeDi.makeGetAppSettingByKeyController(),
  },
  {
    authenticated: true,
    adminOnly: true,
    controller: backofficeDi.makeUpdateAppSettingController(),
  },
  {
    authenticated: true,
    adminOnly: true,
    controller: backofficeDi.makeDeleteAppSettingController(),
  },
];

const controllers = [
  ...tenantControllers,
  ...propertyControllers,
  ...authControllers,
  ...discoveryControllers,
  ...delegatedAccessControllers,
  ...stayControllers,
  ...financeControllers,
  ...propertyManagementControllers,
  ...backofficeControllers,
  healthController,
];

const routeMap = new Map<
  string,
  Partial<Record<HttpControllerMethod, (request: Request) => Promise<Response>>>
>();

controllers.forEach(({ authenticated, adminOnly, controller }) => {
  const alreadyExists = routeMap.get(controller.path);
  if (!alreadyExists) {
    routeMap.set(controller.path, {
      [controller.method]: BunHttpControllerAdapter(
        controller,
        authenticated,
        adminOnly
      ),
      // Add OPTIONS handler for CORS preflight
      [HttpControllerMethod.OPTIONS]: async (request: Request) =>
        corsMiddleware.handlePreflightRequest(request, controller.corsPolicy),
    });
  } else {
    routeMap.set(controller.path, {
      ...alreadyExists,
      [controller.method]: BunHttpControllerAdapter(
        controller,
        authenticated,
        adminOnly
      ),
      // Add OPTIONS handler for CORS preflight
      [HttpControllerMethod.OPTIONS]: async (request: Request) =>
        corsMiddleware.handlePreflightRequest(request, controller.corsPolicy),
    });
  }
});

const handleMcpRequest = makeMcpRequestHandler({
  propertyDi,
  stayDi,
  financeDi,
  propertyManagementDi,
});

routeMap.set("/mcp", {
  [HttpControllerMethod.POST]: handleMcpRequest,
  [HttpControllerMethod.GET]: handleMcpRequest,
  [HttpControllerMethod.DELETE]: handleMcpRequest,
});

const openApiSpec = new OpenApiBuilder(controllers).build();

routeMap.set("/docs/spec", {
  [HttpControllerMethod.GET]: async () => Response.json(openApiSpec),
  [HttpControllerMethod.OPTIONS]: async (request: Request) =>
    corsMiddleware.handlePreflightRequest(request),
});

routeMap.set("/docs", {
  [HttpControllerMethod.GET]: async () =>
    new Response(swaggerUiHtml("/docs/spec", { signInPath: "/auth/sign-in" }), {
      headers: { "Content-Type": "text/html" },
    }),
});

export const bunRoutes = Object.fromEntries(routeMap.entries());
