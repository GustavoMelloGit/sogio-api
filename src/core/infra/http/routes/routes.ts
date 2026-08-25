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
import { BillingDi } from "../../../../billing/infra/di/billing_di";
import { NotificationDi } from "../../../../notification/infra/di/notification_di";
import type { AccessCapabilityKey } from "../../../../billing/domain/capability/capability_registry";
import { OpenApiBuilder } from "../swagger/open_api_builder";
import { scalarUiHtml } from "../swagger/scalar_ui";
import { makeMcpRequestHandler } from "../../mcp/routes";
import { MAX_REQUEST_BODY_BYTES } from "../body/body_limits";

const tenantDi = new TenantDi();
const propertyDi = new PropertyDi();
const authDi = new AuthDi();
const stayDi = new StayDi();
const corsMiddleware = new CorsMiddleware();
const financeDi = new FinanceDi();
const billingDi = new BillingDi();
const propertyManagementDi = new PropertyManagementDi(
  billingDi.makeEntitlementService(),
  stayDi.makeStayPropertyOccupancy()
);
const backofficeDi = new BackofficeDi();
const notificationDi = new NotificationDi();

stayDi.registerEventHandlers();
financeDi.registerEventHandlers();
billingDi.registerEventHandlers();
notificationDi.registerEventHandlers();

type Route = {
  controller: Controller;
  authenticated: boolean;
  adminOnly?: boolean;
  /**
   * Opt-out of the DA-9 platform-access gate. Fail-closed by default — only
   * set this for a route a blocked user must still be able to reach (their
   * own account, LGPD deletion, OAuth connection hygiene, the OAuth
   * protocol step itself). See `.claude/plans/2026-08-15-add-billing-subscriptions.md`.
   */
  allowWithoutPlatformAccess?: boolean;
  requiredCapability?: AccessCapabilityKey;
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
  {
    authenticated: true,
    requiredCapability: "bulk_import",
    controller: propertyDi.makeImportStaysController(),
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
  {
    authenticated: true,
    requiredCapability: "bulk_import",
    controller: financeDi.makeImportLedgerEntriesController(),
  },
  {
    authenticated: true,
    controller: financeDi.makeDeleteLedgerEntryController(),
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
  {
    authenticated: true,
    controller: propertyManagementDi.makeCreatePropertySettingController(),
  },
  {
    authenticated: true,
    controller: propertyManagementDi.makeListPropertySettingsController(),
  },
  {
    authenticated: true,
    controller: propertyManagementDi.makeGetPropertySettingController(),
  },
  {
    authenticated: true,
    controller: propertyManagementDi.makeUpdatePropertySettingController(),
  },
  {
    authenticated: true,
    controller: propertyManagementDi.makeDeletePropertySettingController(),
  },
  {
    // DA-10: deleting a property never unblocks a paywalled account, so —
    // unlike checkout/portal — this route stays behind the platform-access
    // gate.
    authenticated: true,
    controller: propertyManagementDi.makeDeletePropertyController(),
  },
  {
    authenticated: true,
    requiredCapability: "bulk_import",
    controller: propertyManagementDi.makeImportPropertiesController(),
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
    allowWithoutPlatformAccess: true,
    controller: authDi.makeGetUserController(),
  },
  {
    authenticated: true,
    allowWithoutPlatformAccess: true,
    controller: authDi.makeGetUserPreferencesController(),
  },
  {
    authenticated: true,
    allowWithoutPlatformAccess: true,
    controller: authDi.makeUpdateUserPreferencesController(),
  },
  {
    authenticated: true,
    allowWithoutPlatformAccess: true,
    controller: authDi.makePurgeUserDataController(),
  },
  {
    authenticated: true,
    controller: authDi.makeChangePasswordController(),
  },
  {
    authenticated: false,
    controller: authDi.makeRequestPasswordResetController(),
  },
  {
    authenticated: false,
    controller: authDi.makeResetPasswordController(),
  },
  {
    authenticated: true,
    allowWithoutPlatformAccess: true,
    controller: authDi.makeListConnectedAppsController(),
  },
  {
    authenticated: true,
    allowWithoutPlatformAccess: true,
    controller: authDi.makeDisconnectAppController(),
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
    allowWithoutPlatformAccess: true,
    controller: authDi.makeDecideAuthorizationRequestController(),
  },
  {
    authenticated: false,
    controller: authDi.makeTokenController(),
  },
  {
    authenticated: false,
    controller: authDi.makeRevokeController(),
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

const billingControllers: Route[] = [
  {
    // Public pricing page — no login required, analogous to
    // GET /public/booking/stay/:stay_id.
    authenticated: false,
    controller: billingDi.makeListPlansController(),
  },
  {
    authenticated: true,
    allowWithoutPlatformAccess: true,
    controller: billingDi.makeGetSubscriptionStatusController(),
  },
  {
    authenticated: true,
    allowWithoutPlatformAccess: true,
    controller: billingDi.makeGetSubscriptionHistoryController(),
  },
  {
    // DA-5: a blocked account must still be able to pay its way out — the
    // only exit from the paywall cannot itself sit behind the paywall (R-2).
    authenticated: true,
    allowWithoutPlatformAccess: true,
    controller: billingDi.makeCreateCheckoutSessionController(),
  },
  {
    // DA-5, same justification as the checkout session route above.
    authenticated: true,
    allowWithoutPlatformAccess: true,
    controller: billingDi.makeCreateBillingPortalSessionController(),
  },
  {
    // The caller is the gateway, not a logged-in user — outside the
    // platform-access gate by construction, not by exception.
    authenticated: false,
    controller: billingDi.makeStripeWebhookController(),
  },
  {
    authenticated: true,
    adminOnly: true,
    allowWithoutPlatformAccess: true,
    controller: billingDi.makeSyncPlanCatalogController(),
  },
];

const notificationControllers: Route[] = [
  {
    authenticated: true,
    controller: notificationDi.makeGetNotificationPreferencesController(),
  },
  {
    authenticated: true,
    controller: notificationDi.makeUpdateNotificationPreferencesController(),
  },
  {
    authenticated: true,
    controller: notificationDi.makeListNotificationsController(),
  },
  {
    authenticated: true,
    controller: notificationDi.makeMarkNotificationReadController(),
  },
  {
    authenticated: true,
    controller: notificationDi.makeMarkAllNotificationsReadController(),
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
  ...billingControllers,
  ...notificationControllers,
  healthController,
];

const routeMap = new Map<
  string,
  Partial<Record<HttpControllerMethod, (request: Request) => Promise<Response>>>
>();

const entitlementService = billingDi.makeEntitlementService();

controllers.forEach(
  ({
    authenticated,
    adminOnly,
    allowWithoutPlatformAccess,
    requiredCapability,
    controller,
  }) => {
    const alreadyExists = routeMap.get(controller.path);
    if (!alreadyExists) {
      routeMap.set(controller.path, {
        [controller.method]: BunHttpControllerAdapter(
          controller,
          authenticated,
          entitlementService,
          adminOnly,
          allowWithoutPlatformAccess,
          requiredCapability
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
          entitlementService,
          adminOnly,
          allowWithoutPlatformAccess,
          requiredCapability
        ),
        // Add OPTIONS handler for CORS preflight
        [HttpControllerMethod.OPTIONS]: async (request: Request) =>
          corsMiddleware.handlePreflightRequest(request, controller.corsPolicy),
      });
    }
  }
);

const handleMcpRequest = makeMcpRequestHandler({
  authDi,
  propertyDi,
  stayDi,
  financeDi,
  billingDi,
  propertyManagementDi,
  notificationDi,
  tenantDi,
});

routeMap.set("/mcp", {
  [HttpControllerMethod.POST]: handleMcpRequest,
  [HttpControllerMethod.GET]: handleMcpRequest,
  [HttpControllerMethod.DELETE]: handleMcpRequest,
  /**
   * `Authorization` and a JSON `Content-Type` are both non-simple for CORS,
   * so a browser-based MCP client preflights every call with `OPTIONS`
   * before it. Without this handler the preflight itself 404s and the
   * browser never sends the real request — the E8 gap task 13 left open
   * (see the comment on `unauthorizedResponse` in `mcp/routes.ts`).
   */
  [HttpControllerMethod.OPTIONS]: async (request: Request) =>
    corsMiddleware.handlePreflightRequest(request, "public"),
});

const openApiSpec = new OpenApiBuilder(controllers).build();

routeMap.set("/docs/spec", {
  [HttpControllerMethod.GET]: async () => Response.json(openApiSpec),
  [HttpControllerMethod.OPTIONS]: async (request: Request) =>
    corsMiddleware.handlePreflightRequest(request),
});

routeMap.set("/docs", {
  [HttpControllerMethod.GET]: async () =>
    new Response(scalarUiHtml("/docs/spec", { signInPath: "/auth/sign-in" }), {
      headers: { "Content-Type": "text/html" },
    }),
});

export const bunRoutes = Object.fromEntries(routeMap.entries());

export const bunServeOptions = {
  routes: bunRoutes,
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
};
